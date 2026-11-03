"use server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { assignments, matches, matchEvents, matchSquads, evaluations, commissionerReports } from "@/db/schema";
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
    await db.update(matches).set({
      homeScore: home, awayScore: away, attendance: int(f, "attendance"), reportNotes: str(f, "reportNotes"),
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
    await myRole(u.officialId, matchId, ["COMMISSIONER", "REF_OBSERVER"]);
    const [ex] = await db.select().from(commissionerReports).where(eq(commissionerReports.matchId, matchId));
    if (ex?.isSubmitted) throw new UserError("التقرير مُرسل مسبقًا");
    const row = {
      matchId, officialId: u.officialId, actualKickoff: str(f, "actualKickoff"), attendance: int(f, "attendance"), pitch: str(f, "pitch"),
      organization: str(f, "organization"), security: str(f, "security"), incidents: str(f, "incidents"), recommendations: str(f, "recommendations"),
      isSubmitted: submit, submittedAt: submit ? new Date() : null,
    };
    await db.insert(commissionerReports).values(row).onConflictDoUpdate({ target: commissionerReports.matchId, set: row });
    if (submit) {
      await notifyStaff(["COMP_HEAD", "COMP_STAFF"], "تقرير مراقب مباراة", u.fullName, `/matches/${matchId}?tab=officials`, { matchId });
      await audit(u, "إرسال تقرير مراقب المباراة", "Match", matchId);
    }
    return submit ? "تم إرسال التقرير" : "تم حفظ المسودة";
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
