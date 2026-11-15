import "server-only";
import { and, eq, inArray, lt, isNotNull, gt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { registrations, players, clubs, settings } from "@/db/schema";
import { notifyClub, notifyStaff } from "./audit";
import { getSetting, getCurrentSeason, categoryFor, logEvent, openWindow } from "./registration";
import { medicalMonths, medicalExpiry } from "./regchecks";
import { today } from "./util";

const DAY = 864e5;
const SYS = "المنظومة (تلقائي)";
const num = async (k: string, d: number) => { const n = Number(await getSetting(k, String(d))); return Number.isFinite(n) && n >= 0 ? n : d; };
const setSetting = (key: string, value: string) => db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } });

/** 2) مهلة رد النادي السابق: بعد انقضائها يُعتبر الصمت «عدم اعتراض» */
export async function originDeadlineJob() {
  const days = await num("origin_deadline_days", 7);
  if (!days) return 0;
  const from = alias(clubs, "from_club");
  const rows = await db.select({ r: registrations, name: players.fullName, toName: clubs.name, fromName: from.name }).from(registrations)
    .innerJoin(players, eq(players.id, registrations.playerId)).innerJoin(clubs, eq(clubs.id, registrations.clubId)).leftJoin(from, eq(from.id, registrations.fromClubId))
    .where(and(eq(registrations.originResponse, "PENDING"), inArray(registrations.status, ["SUBMITTED", "NEEDS_CORRECTION"]), lt(registrations.submittedAt, new Date(Date.now() - days * DAY))));
  for (const x of rows) {
    await db.transaction(async (tx) => {
      const note = `لم يرد النادي السابق خلال المهلة (${days} أيام) — اعتُبر عدم اعتراض`;
      await tx.update(registrations).set({ originResponse: "AGREED", originReason: note, originRespondedAt: new Date(), updatedAt: new Date() }).where(eq(registrations.id, x.r.id));
      await logEvent(tx, x.r.id, SYS, "انقضاء مهلة رد النادي السابق", note);
      if (x.r.fromClubId) await notifyClub(x.r.fromClubId, "انقضت مهلة الرد على طلب انتقال", `${x.name} — إلى ${x.toName}: اعتُبر عدم اعتراض لعدم الرد خلال ${days} أيام`, "/club/origin", tx);
      await notifyClub(x.r.clubId, "تجاوز رد النادي السابق", `${x.name}: لم يرد ${x.fromName ?? "النادي السابق"} خلال المهلة فاعتُبر عدم اعتراض`, `/club/registrations/${x.r.id}`, tx);
    });
  }
  return rows.length;
}

/** 3) انتهاء الإعارة: إبلاغ الناديين وتجهيز طلب «عودة من إعارة» للنادي الأصلي */
export async function loanEndJob() {
  const season = await getCurrentSeason();
  if (!season) return 0;
  const loans = await db.select({ r: registrations, p: players }).from(registrations).innerJoin(players, eq(players.id, registrations.playerId))
    .where(and(eq(registrations.type, "LOAN"), eq(registrations.status, "APPROVED"), eq(registrations.seasonId, season.id), isNotNull(registrations.fromClubId), lt(registrations.loanEndDate, today())));
  let n = 0;
  for (const { r, p } of loans) {
    // طلب لاحق للاعب (عودة أو انتقال) قيد المعالجة أو معتمد ← لا حاجة
    const [later] = await db.select({ id: registrations.id }).from(registrations)
      .where(and(eq(registrations.playerId, r.playerId), eq(registrations.seasonId, season.id), gt(registrations.id, r.id), inArray(registrations.status, ["DRAFT", "SUBMITTED", "NEEDS_CORRECTION", "APPROVED"])));
    if (later) continue;
    const cat = await categoryFor(p.dateOfBirth, season.startDate);
    await db.transaction(async (tx) => {
      const [nr] = await tx.insert(registrations).values({
        playerId: r.playerId, clubId: r.fromClubId!, seasonId: season.id, type: "LOAN_RETURN", status: "DRAFT", categoryId: cat?.id, fromClubId: r.clubId,
        originResponse: "NOT_REQUIRED", notes: `أُنشئ تلقائيًا بانتهاء الإعارة في ${r.loanEndDate}`,
      }).returning();
      await logEvent(tx, nr.id, SYS, "إنشاء طلب عودة من إعارة", `انتهت الإعارة في ${r.loanEndDate}`);
      await notifyClub(r.fromClubId!, "انتهت إعارة لاعبكم", `${p.fullName} — جهّزنا طلب «عودة من إعارة»: راجعه وأرسله`, `/club/registrations/${nr.id}`, tx);
      await notifyClub(r.clubId, "انتهت مدة إعارة لاعب", `${p.fullName} — انتهت الإعارة في ${r.loanEndDate} ويعود لناديه الأصلي`, "/club/players", tx);
    });
    n++;
  }
  return n;
}

/** 4) الطلبات المتأخرة لدى اللجنة: تنبيه يومي لرئيس اللجنة */
export async function overdueReviewJob() {
  const days = await num("review_sla_days", 3);
  if (!days) return 0;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(registrations)
    .where(and(eq(registrations.status, "SUBMITTED"), lt(registrations.submittedAt, new Date(Date.now() - days * DAY))));
  if (n) await notifyStaff(["REG_HEAD"], "طلبات قيد متأخرة", `${n} طلب مضى على إرساله أكثر من ${days} أيام دون قرار`, "/registration/requests?status=SUBMITTED&late=1", {});
  return n;
}

/** 5) تذكير النادي بالطلبات المعادة للتصحيح (بعد 3 أيام ثم بعد 7 أيام) */
export async function correctionReminderJob() {
  const rows = await db.select({ r: registrations, name: players.fullName }).from(registrations).innerJoin(players, eq(players.id, registrations.playerId))
    .where(and(eq(registrations.status, "NEEDS_CORRECTION"), lt(registrations.correctionReminders, 2), lt(registrations.decidedAt, new Date(Date.now() - 3 * DAY))));
  let n = 0;
  for (const { r, name } of rows) {
    const age = (Date.now() - new Date(r.decidedAt!).getTime()) / DAY;
    const step = age >= 7 ? 2 : 1;
    if (step <= r.correctionReminders) continue;
    const w = await openWindow(r.seasonId, r.clubId);
    const left = w ? Math.max(0, Math.ceil((new Date(w.endDate + "T23:59:59").getTime() - Date.now()) / DAY)) : null;
    await db.transaction(async (tx) => {
      await tx.update(registrations).set({ correctionReminders: step }).where(eq(registrations.id, r.id));
      await notifyClub(r.clubId, step === 1 ? "تذكير: طلب معاد للتصحيح" : "تذكير أخير: طلب معاد للتصحيح",
        `${name} — أُعيد منذ ${Math.floor(age)} أيام${r.decisionReason ? `: ${r.decisionReason}` : ""}${left != null ? ` — متبقٍ على إغلاق فترة القيد ${left} يومًا` : " — فترة القيد مغلقة حاليًا"}`,
        `/club/registrations/${r.id}`, tx);
      await logEvent(tx, r.id, SYS, step === 1 ? "تذكير النادي بالتصحيح" : "تذكير أخير للنادي بالتصحيح");
    });
    n++;
  }
  return n;
}

/** 7) قرب انتهاء الكشف الطبي (خلال 30 يومًا) أو انتهاؤه: تنبيه واحد لكل كشف، مجمّع لكل نادٍ */
export async function medicalJob() {
  const season = await getCurrentSeason();
  if (!season) return 0;
  const months = await medicalMonths();
  const rows = await db.select({ id: players.id, name: players.fullName, exam: players.medicalExamDate, notified: players.medicalNotifiedFor, clubId: registrations.clubId })
    .from(players).innerJoin(registrations, eq(registrations.playerId, players.id))
    .where(and(eq(registrations.seasonId, season.id), eq(registrations.status, "APPROVED"), isNotNull(players.medicalExamDate)));
  const soon = new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10);
  const byClub = new Map<number, { id: number; name: string; exp: string; exam: string }[]>();
  for (const x of rows) {
    const exp = medicalExpiry(x.exam, months)!;
    if (exp > soon || x.notified === x.exam) continue;
    const l = byClub.get(x.clubId) ?? []; l.push({ id: x.id, name: x.name, exp, exam: x.exam! }); byClub.set(x.clubId, l);
  }
  const t = today();
  for (const [clubId, list] of byClub) {
    await db.transaction(async (tx) => {
      await notifyClub(clubId, `الكشف الطبي: ${list.length} لاعب`, list.map((x) => `${x.name} (${x.exp < t ? "منتهٍ" : "ينتهي"} ${x.exp})`).join("، "), "/club/players?medical=1", tx);
      for (const x of list) await tx.update(players).set({ medicalNotifiedFor: x.exam }).where(eq(players.id, x.id));
    });
  }
  return byClub.size;
}

/** تشغيل المهام الدورية مرة كل ساعة على الأكثر (تُستدعى عند فتح موظف لجنة القيد للمنظومة) */
export async function maybeRunRegJobs() {
  try {
    const last = Number(await getSetting("regjobs_last", "0"));
    if (Date.now() - last < 3600_000) return;
    await setSetting("regjobs_last", String(Date.now()));
    const day = today();
    const daily = (await getSetting("regjobs_day", "")) !== day;
    for (const job of [originDeadlineJob, loanEndJob, correctionReminderJob, medicalJob]) {
      try { await job(); } catch (e) { console.error("regjob", job.name, e); }
    }
    if (daily) { await setSetting("regjobs_day", day); try { await overdueReviewJob(); } catch (e) { console.error("regjob overdue", e); } }
  } catch (e) { console.error("regjobs", e); }
}
