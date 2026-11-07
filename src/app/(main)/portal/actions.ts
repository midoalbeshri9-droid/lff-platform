"use server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { getTemplate, answersFrom, requireAnswers } from "@/lib/reports";
import { saveUpload, ALLOWED_DOC } from "@/lib/storage";
import { assignments, matches, matchEvents, matchSquads, evaluations, matchReportForms, reportFiles } from "@/db/schema";
import { requireOfficialUser } from "@/lib/auth";
import { audit, notifyRoles, notifyStaff } from "@/lib/audit";
import { attempt, str, req, int, UserError } from "@/lib/util";
import { foreignOnPitchCheck, subsLimitCheck } from "@/lib/competition";

/** يتحقق أن المستخدم معيّن (تعيينًا معتمدًا) في هذه المباراة بهذا الدور */
async function myRole(officialId: number, matchId: number, roles: string[]) {
  const rows = await db.select().from(assignments).where(and(eq(assignments.matchId, matchId), eq(assignments.officialId, officialId), eq(assignments.status, "APPROVED")));
  const r = rows.find((x) => roles.includes(x.role));
  if (!r) throw new UserError("أنت غير معيّن في هذه المباراة بهذه الصفة");
  return r;
}

// ---------------- تقرير حكم الساحة ----------------
async function refEditable(matchId: number) {
  const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
  if (!m) throw new UserError("المباراة غير موجودة");
  if (!["NONE", "RETURNED"].includes(m.reportStatus)) throw new UserError("التقرير مُرسل — لا يمكن التعديل إلا إذا أعادته اللجنة");
  return m;
}

export async function refAddEvent(f: FormData) {
  const u = await requireOfficialUser();
  const matchId = int(f, "matchId")!;
  await attempt(`/portal/matches/${matchId}`, async () => {
    await myRole(u.officialId, matchId, ["REFEREE"]);
    const m = await refEditable(matchId);
    let clubId = int(f, "clubId")!;
    const playerId = int(f, "playerId");
    // فريق اللاعب يؤخذ من قائمة المباراة
    if (playerId) {
      const [own] = await db.select({ c: matchSquads.clubId }).from(matchSquads).where(and(eq(matchSquads.matchId, matchId), eq(matchSquads.playerId, playerId)));
      if (own) clubId = own.c;
    }
    if (![m.homeClubId, m.awayClubId].includes(clubId)) throw new UserError("الفريق غير صحيح");
    if (playerId) {
      const [s] = await db.select().from(matchSquads).where(and(eq(matchSquads.matchId, matchId), eq(matchSquads.clubId, clubId), eq(matchSquads.playerId, playerId)));
      if (!s) throw new UserError("اللاعب ليس في قائمة هذا الفريق في المباراة");
    }
    const type = str(f, "type") as "GOAL" | "SUB_IN";
    if (type === "SUB_IN") await subsLimitCheck(matchId, clubId, int(f, "minute"));
    if (type === "SUB_IN" && playerId) await foreignOnPitchCheck(matchId, clubId, playerId);
    await db.insert(matchEvents).values({ matchId, clubId, playerId, type, minute: int(f, "minute"), note: str(f, "note") });
    return "تمت إضافة الحدث";
  });
}

export async function refDeleteEvent(f: FormData) {
  const u = await requireOfficialUser();
  const matchId = int(f, "matchId")!;
  await attempt(`/portal/matches/${matchId}`, async () => {
    await myRole(u.officialId, matchId, ["REFEREE"]);
    await refEditable(matchId);
    await db.delete(matchEvents).where(and(eq(matchEvents.id, int(f, "eventId")!), eq(matchEvents.matchId, matchId)));
    return "تم الحذف";
  });
}

export async function refSaveReport(f: FormData) {
  const u = await requireOfficialUser();
  const matchId = int(f, "matchId")!;
  const submit = f.get("submit") === "1";
  await attempt(`/portal/matches/${matchId}`, async () => {
    await myRole(u.officialId, matchId, ["REFEREE"]);
    const m = await refEditable(matchId);
    const home = int(f, "homeScore"), away = int(f, "awayScore");
    if (submit && (home == null || away == null)) throw new UserError("أدخل النتيجة النهائية قبل الإرسال");
    if ((home != null && home < 0) || (away != null && away < 0)) throw new UserError("النتيجة لا تكون سالبة");
    if (submit && m.kickoff && m.kickoff.getTime() > Date.now()) throw new UserError("لا يمكن إرسال التقرير قبل موعد المباراة");
    await saveForm("REFEREE", matchId, u.officialId, f, submit);
    await db.update(matches).set({
      homeScore: home, awayScore: away, attendance: int(f, "attendance"), ...(f.has("reportNotes") ? { reportNotes: str(f, "reportNotes") } : {}),
      ...(submit ? { reportStatus: "SUBMITTED" as const, reportSubmittedAt: new Date(), reportReturn: null } : {}),
    }).where(eq(matches.id, matchId));
    if (submit) {
      await notifyStaff(["COMP_HEAD", "COMP_STAFF"], "تقرير مباراة جديد", `من الحكم ${u.fullName}`, `/matches/${matchId}`, { matchId });
      await audit(u, "إرسال تقرير الحكم", "Match", matchId);
    }
    return submit ? "تم إرسال التقرير إلى لجنة المسابقات" : "تم حفظ المسودة";
  });
}

// ---------------- تقييم مراقب الحكام ----------------
export async function saveEvaluation(f: FormData) {
  const u = await requireOfficialUser();
  const matchId = int(f, "matchId")!;
  const submit = f.get("submit") === "1";
  await attempt(`/portal/matches/${matchId}`, async () => {
    await myRole(u.officialId, matchId, ["REF_OBSERVER", "COMMISSIONER"]);
    const crew = await db.select().from(assignments).where(and(eq(assignments.matchId, matchId), inArray(assignments.role, ["REFEREE", "AR1", "AR2", "FOURTH", "VAR"]), eq(assignments.status, "APPROVED")));
    const done = await db.select().from(evaluations).where(and(eq(evaluations.matchId, matchId), eq(evaluations.observerId, u.officialId), eq(evaluations.isSubmitted, true)));
    if (done.length) throw new UserError("التقييم مُرسل مسبقًا");
    for (const a of crew) {
      const score = Number(f.get(`score_${a.officialId}`));
      if (!f.get(`score_${a.officialId}`)) { if (submit) throw new UserError("أدخل الدرجة لكل أفراد الطاقم"); continue; }
      if (!(score >= 0 && score <= 10)) throw new UserError("الدرجة بين 0 و 10");
      const sub = (k: string) => int(f, `${k}_${a.officialId}`);
      const row = {
        matchId, observerId: u.officialId, officialId: a.officialId, role: a.role, score,
        positioning: sub("pos"), fitness: sub("fit"), decisions: sub("dec"), control: sub("ctl"), notes: str(f, `notes_${a.officialId}`),
        isSubmitted: submit, submittedAt: submit ? new Date() : null,
      };
      await db.insert(evaluations).values(row).onConflictDoUpdate({ target: [evaluations.matchId, evaluations.officialId], set: row });
    }
    if (submit) {
      await notifyStaff(["REF_HEAD", "COMP_HEAD"], "تقييم الحكام من مراقب المباراة", u.fullName, `/matches/${matchId}?tab=officials`, { matchId });
      await audit(u, "إرسال تقييم الحكام", "Match", matchId);
    }
    return submit ? "تم إرسال التقييم إلى لجنة الحكام" : "تم حفظ المسودة";
  });
}

// ---------------- تقرير مراقب المباراة ----------------
export async function saveCommissionerReport(f: FormData) {
  const u = await requireOfficialUser();
  const matchId = int(f, "matchId")!;
  const submit = f.get("submit") === "1";
  await attempt(`/portal/matches/${matchId}`, async () => {
    await myRole(u.officialId, matchId, ["COMMISSIONER"]);
    const [ex] = await db.select().from(matchReportForms).where(and(eq(matchReportForms.matchId, matchId), eq(matchReportForms.kind, "COMMISSIONER")));
    if (ex?.isSubmitted) throw new UserError("التقرير مُرسل مسبقًا");
    if (submit) { const [m] = await db.select({ k: matches.kickoff }).from(matches).where(eq(matches.id, matchId)); if (m?.k && m.k.getTime() > Date.now()) throw new UserError("لا يمكن إرسال التقرير قبل موعد المباراة"); }
    await saveForm("COMMISSIONER", matchId, u.officialId, f, submit);
    if (submit) {
      await notifyStaff(["COMP_HEAD", "COMP_STAFF"], "تقرير مراقب مباراة", u.fullName, `/matches/${matchId}?tab=officials`, { matchId });
      await audit(u, "إرسال تقرير مراقب المباراة", "Match", matchId);
    }
    return submit ? "تم إرسال التقرير إلى لجنة المسابقات" : "تم حفظ المسودة";
  });
}

/** حفظ خانات نموذج التقرير (نسخة من النموذج الحالي ما دام التقرير قابلًا للتعديل) */
async function saveForm(kind: "REFEREE" | "COMMISSIONER", matchId: number, officialId: number, f: FormData, submit: boolean) {
  const t = await getTemplate(kind);
  const fields = t.fields;
  const answers = answersFrom(f, fields);
  if (submit) {
    requireAnswers(fields, answers);
    if (t.requireAttachment) {
      const [x] = await db.select({ id: reportFiles.id }).from(reportFiles).where(and(eq(reportFiles.matchId, matchId), eq(reportFiles.kind, kind))).limit(1);
      if (!x) throw new UserError("أرفق التقرير الورقي (صورة أو PDF) قبل الإرسال");
    }
  }
  const row = { matchId, kind, officialId, fields, answers, isSubmitted: submit, submittedAt: submit ? new Date() : null, updatedAt: new Date() };
  await db.insert(matchReportForms).values(row).onConflictDoUpdate({ target: [matchReportForms.matchId, matchReportForms.kind], set: row });
}

/** هل يملك المسؤول تعديل مرفقات هذا التقرير الآن؟ */
async function reportEditable(officialId: number, matchId: number, kind: "REFEREE" | "COMMISSIONER") {
  if (kind === "REFEREE") { await myRole(officialId, matchId, ["REFEREE"]); await refEditable(matchId); return; }
  await myRole(officialId, matchId, ["COMMISSIONER"]);
  const [ex] = await db.select({ s: matchReportForms.isSubmitted }).from(matchReportForms).where(and(eq(matchReportForms.matchId, matchId), eq(matchReportForms.kind, "COMMISSIONER")));
  if (ex?.s) throw new UserError("التقرير مُرسل — لا يمكن تعديل المرفقات");
}

/** رفع مرفق للتقرير (ملف واحد في كل طلب) */
export async function uploadReportFile(fd: FormData): Promise<{ ok: boolean; msg: string }> {
  try {
    const u = await requireOfficialUser();
    const matchId = Number(fd.get("matchId")), kind = String(fd.get("kind")) as "REFEREE" | "COMMISSIONER";
    if (kind !== "REFEREE" && kind !== "COMMISSIONER") throw new UserError("نوع غير صحيح");
    await reportEditable(u.officialId, matchId, kind);
    const file = fd.get("file") as File | null;
    if (!file || !file.size) throw new UserError("ملف فارغ");
    const n = await db.select({ id: reportFiles.id }).from(reportFiles).where(and(eq(reportFiles.matchId, matchId), eq(reportFiles.kind, kind)));
    if (n.length >= 20) throw new UserError("الحد الأقصى 20 مرفقًا للتقرير");
    const s = await saveUpload(file, "reports", ALLOWED_DOC);
    await db.insert(reportFiles).values({ matchId, kind, officialId: u.officialId, fileKey: s.key, originalName: file.name, mime: file.type, size: file.size });
    return { ok: true, msg: "أُرفق" };
  } catch (e) {
    return { ok: false, msg: e instanceof UserError ? e.message : "تعذر الرفع" };
  }
}

export async function deleteReportFile(f: FormData) {
  const u = await requireOfficialUser();
  const matchId = int(f, "matchId")!;
  await attempt(`/portal/matches/${matchId}`, async () => {
    const [x] = await db.select().from(reportFiles).where(and(eq(reportFiles.id, int(f, "id")!), eq(reportFiles.matchId, matchId), eq(reportFiles.officialId, u.officialId)));
    if (!x) throw new UserError("المرفق غير موجود");
    await reportEditable(u.officialId, matchId, x.kind);
    await db.delete(reportFiles).where(eq(reportFiles.id, x.id));
    return "حُذف المرفق";
  });
}

// ---------------- اعتذار عن التعيين ----------------
export async function declineAssignment(f: FormData) {
  const u = await requireOfficialUser();
  await attempt("/portal", async () => {
    const id = int(f, "assignmentId")!;
    const [a] = await db.select().from(assignments).where(and(eq(assignments.id, id), eq(assignments.officialId, u.officialId)));
    if (!a || a.status === "DECLINED") throw new UserError("التعيين غير متاح");
    const matchId = a.matchId; // المباراة من التعيين نفسه لا من النموذج
    const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
    if (m.kickoff && m.kickoff.getTime() < Date.now()) throw new UserError("بدأت المباراة");
    const reason = req(f, "reason", "سبب الاعتذار");
    await db.update(assignments).set({ status: "DECLINED", declineReason: reason }).where(eq(assignments.id, id));
    const obs = a.role === "COMMISSIONER" || a.role === "REF_OBSERVER";
    await notifyStaff(obs ? ["COMP_HEAD", "COMP_STAFF"] : ["REF_HEAD", "REF_STAFF"], `اعتذار عن تعيين${obs ? " مراقب مباراة" : ""} — ${u.fullName}`, reason, obs ? `/matches/${matchId}?tab=officials` : `/referees/assignments/${matchId}`, { matchId });
    await audit(u, "اعتذار عن تعيين", "Match", matchId, reason);
    return obs ? "تم تسجيل اعتذارك وإبلاغ لجنة المسابقات" : "تم تسجيل اعتذارك وإبلاغ لجنة الحكام";
  });
}
