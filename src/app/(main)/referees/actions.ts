"use server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { officials, officialTests, assignments, matches, clubs, users } from "@/db/schema";
import { scopeOf, compIn, officialIn, guard, guardPage, inScopeOfficial, inScopeMatch } from "@/lib/scope";
import { requireUser } from "@/lib/auth";
import { audit, notifyOfficial } from "@/lib/audit";
import { ASSIGN_ROLE, OBSERVER_ROLES } from "@/lib/labels";
import { checkAssignment } from "@/lib/assign";
import { attempt, str, req, int, bool, UserError, reqEmail, reqPhone } from "@/lib/util";
import { ensureUniqueContact, sentMsg } from "@/lib/users";
import { sendActivation, unusableHash } from "@/lib/tokens";

export async function saveOfficial(f: FormData) {
  const u = await requireUser("ref.manage");
  const id = int(f, "id");
  let newId = 0;
  await attempt(id ? `/referees/${id}` : "/referees", async () => {
    if (id) guard(await inScopeOfficial(u, id, true));
    const data = {
      fullName: req(f, "fullName", "الاسم"), type: str(f, "type") as "REFEREE", grade: (str(f, "grade") ?? "THIRD") as "THIRD",
      city: str(f, "city"), phone: str(f, "phone"), email: str(f, "email"), dateOfBirth: str(f, "dateOfBirth"),
      licenseNo: str(f, "licenseNo"), licenseExpiry: str(f, "licenseExpiry"), notes: str(f, "notes"),
      // مدير الدرجة يسجل حكام درجته فقط؛ والاتحاد يحدد الدرجة أو يتركها للقائمة الاتحادية
      divisionId: u.divisionId ?? int(f, "divisionId"),
    };
    if (id) await db.update(officials).set(data).where(eq(officials.id, id));
    else newId = (await db.insert(officials).values(data).returning())[0].id;
    await audit(u, id ? "تعديل حكم/مراقب" : "إضافة حكم/مراقب", "Official", id ?? newId, data.fullName);
    return "تم الحفظ";
  });
}

export async function setOfficialStatus(f: FormData) {
  const u = await requireUser("ref.manage");
  const id = int(f, "id")!;
  await attempt(`/referees/${id}`, async () => {
    guard(await inScopeOfficial(u, id, true));
    const status = str(f, "status") as "ACTIVE" | "SUSPENDED" | "INJURED" | "RETIRED";
    const until = str(f, "suspendedUntil");
    await db.update(officials).set({ status, suspendedUntil: status === "SUSPENDED" ? until : null, notes: str(f, "notes") }).where(eq(officials.id, id));
    await audit(u, "تغيير حالة حكم", "Official", id, { status, until });
    return "تم تحديث الحالة";
  });
}

export async function addTest(f: FormData) {
  const u = await requireUser("ref.manage");
  const id = int(f, "officialId")!;
  await attempt(`/referees/${id}`, async () => {
    guard(await inScopeOfficial(u, id, true));
    const kind = req(f, "kind", "النوع");
    const passed = f.get("passed") === "1";
    const date = req(f, "date", "التاريخ");
    await db.insert(officialTests).values({ officialId: id, title: req(f, "title", "العنوان"), kind, date, passed, score: f.get("score") ? Number(f.get("score")) : null, notes: str(f, "notes") });
    if (kind === "لياقة") await db.update(officials).set({ fitness: passed ? "PASSED" : "FAILED", lastTestAt: date }).where(eq(officials.id, id));
    await audit(u, "تسجيل اختبار", "Official", id, { kind, passed });
    return "تم تسجيل الاختبار";
  });
}

/** إنشاء حساب دخول للحكم/المراقب — يرى تعييناته ويدخل تقاريره فقط (التفعيل عبر البريد) */
export async function createOfficialAccount(f: FormData) {
  const u = await requireUser("ref.manage");
  const id = int(f, "officialId")!;
  await attempt(`/referees/${id}`, async () => {
    guard(await inScopeOfficial(u, id, true));
    const [o] = await db.select().from(officials).where(eq(officials.id, id));
    const [ex] = await db.select().from(users).where(eq(users.officialId, id));
    if (ex) throw new UserError("للحكم حساب مسبقًا: " + ex.username);
    const username = req(f, "username", "اسم المستخدم").toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new UserError("اسم المستخدم: حروف إنجليزية وأرقام");
    const email = reqEmail(f), phone = reqPhone(f);
    await ensureUniqueContact(email, phone);
    const role = o.type === "REF_OBSERVER" || o.type === "COMMISSIONER" ? "OBSERVER" : "REFEREE";
    const [n] = await db.insert(users).values({ username, fullName: o.fullName, phone, email, role, officialId: id, passwordHash: unusableHash(), isVerified: false }).returning();
    await db.update(officials).set({ email, phone }).where(eq(officials.id, id));
    const r = await sendActivation(n);
    await audit(u, "إنشاء حساب حكم/مراقب", "User", n.id, { username, official: id });
    return `تم إنشاء الحساب (${username}) — ${sentMsg(r.sent)}`;
  });
}

/** اعتذار الحكم عن التعيين يُسجّل من البوابة؛ هنا تعيد اللجنة فتح الدور */
export async function assignOfficial(f: FormData) {
  const role = req(f, "role", "الدور") as "REFEREE";
  const observer = OBSERVER_ROLES.includes(role);
  // مراقب المباراة من صلاحية لجنة المسابقات، وبقية الطاقم من صلاحية لجنة الحكام
  const u = await requireUser(observer ? "comp.observers" : "ref.assign");
  const matchId = int(f, "matchId")!;
  await attempt(str(f, "back") ?? `/referees/assignments/${matchId}`, async () => {
    guard(await inScopeMatch(u, matchId));
    if (int(f, "officialId")) guard(await inScopeOfficial(u, int(f, "officialId")));
    const officialId = int(f, "officialId");
    const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
    if (m.reportStatus === "APPROVED") throw new UserError("المباراة معتمدة");
    if (!officialId) {
      await db.delete(assignments).where(and(eq(assignments.matchId, matchId), eq(assignments.role, role)));
      await audit(u, "إلغاء تعيين", "Match", matchId, role);
      return "تم إلغاء التعيين";
    }
    const { errors, warnings } = await checkAssignment(matchId, officialId, role);
    if (errors.length) throw new UserError("لا يمكن التعيين: " + errors.join("، "));
    if (warnings.length && !bool(f, "force")) throw new UserError("تحذير: " + warnings.join("، ") + " — فعّل «تجاوز التحذيرات» للمتابعة");
    if (observer) {
      // تعيين لجنة المسابقات للمراقب نافذ مباشرة ويُبلَّغ المراقب
      const now = new Date();
      await db.insert(assignments).values({ matchId, officialId, role: "COMMISSIONER", assignedBy: u.fullName, status: "APPROVED", approvedBy: u.fullName, approvedAt: now })
        .onConflictDoUpdate({ target: [assignments.matchId, assignments.role], set: { officialId, status: "APPROVED", assignedBy: u.fullName, assignedAt: now, approvedAt: now, approvedBy: u.fullName, declineReason: null } });
      const cl = await db.select().from(clubs).where(inArray(clubs.id, [m.homeClubId, m.awayClubId]));
      await notifyOfficial(officialId, "تعيين: مراقب المباراة", `${cl.find((c) => c.id === m.homeClubId)?.name} × ${cl.find((c) => c.id === m.awayClubId)?.name}`, `/portal/matches/${matchId}`);
      await audit(u, "تعيين مراقب مباراة", "Match", matchId, { officialId, warnings });
      return `تم تعيين مراقب المباراة وإبلاغه${warnings.length ? " (مع تحذيرات)" : ""}`;
    }
    await db.insert(assignments).values({ matchId, officialId, role, assignedBy: u.fullName, status: "DRAFT" })
      .onConflictDoUpdate({ target: [assignments.matchId, assignments.role], set: { officialId, status: "DRAFT", assignedBy: u.fullName, assignedAt: new Date(), approvedAt: null, approvedBy: null } });
    await audit(u, "تعيين (مسودة)", "Match", matchId, { role, officialId, warnings });
    return `تم التعيين كمسودة — ${ASSIGN_ROLE[role]}${warnings.length ? " (مع تحذيرات)" : ""}`;
  });
}

export async function approveAssignments(f: FormData) {
  const u = await requireUser("ref.approve");
  const matchId = int(f, "matchId")!;
  const back = str(f, "back") ?? `/referees/assignments/${matchId}`;
  await attempt(back, async () => {
    guard(await inScopeMatch(u, matchId));
    const drafts = (await db.select().from(assignments).where(and(eq(assignments.matchId, matchId), eq(assignments.status, "DRAFT")))).filter((a) => !OBSERVER_ROLES.includes(a.role));
    if (!drafts.length) throw new UserError("لا توجد تعيينات مسودة");
    const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
    const cl = await db.select().from(clubs).where(inArray(clubs.id, [m.homeClubId, m.awayClubId]));
    const title = `${cl.find((c) => c.id === m.homeClubId)?.name} × ${cl.find((c) => c.id === m.awayClubId)?.name}`;
    await db.update(assignments).set({ status: "APPROVED", approvedBy: u.fullName, approvedAt: new Date() }).where(inArray(assignments.id, drafts.map((a) => a.id)));
    for (const a of drafts) await notifyOfficial(a.officialId, `تعيين: ${ASSIGN_ROLE[a.role]}`, `${title} — ${m.kickoff?.toLocaleString("en-GB", { timeZone: "Africa/Tripoli" }) ?? ""}`, `/portal/matches/${matchId}`);
    await audit(u, "اعتماد التعيينات", "Match", matchId, { count: drafts.length });
    return `تم اعتماد ${drafts.length} تعيين وإبلاغ الطاقم`;
  });
}
