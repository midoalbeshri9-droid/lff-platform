import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { sanctions, suspensions, matches, counters, charges, settings, players, staff, clubs, sanctionTypeEnum } from "@/db/schema";
import { addCharge, cancelChargeByRef } from "./finance";
import { notifyClub } from "./audit";
import { SANCTION_TYPE, SANCTION_FOR } from "./labels";
import { UserError, today } from "./util";

export type SanctionInput = {
  targetType: "PLAYER" | "STAFF" | "CLUB";
  playerId?: number | null; staffId?: number | null; clubId: number;
  competitionId?: number | null; matchId?: number | null; articleId?: number | null; articleText?: string | null;
  type: (typeof sanctionTypeEnum.enumValues)[number];
  matchesCount?: number | null; fromDate?: string | null; toDate?: string | null; points?: number | null; fineAmount?: string | null;
  reason: string; decisionDate?: string | null; notes?: string | null;
};

async function nextNumber(tx: Tx) {
  const y = new Date().getFullYear();
  const [row] = await tx.insert(counters).values({ key: `sanction:${y}`, value: 1 })
    .onConflictDoUpdate({ target: counters.key, set: { value: sql`${counters.value} + 1` } }).returning();
  return `ق.ع/${y}/${String(row.value).padStart(4, "0")}`;
}

function validate(i: SanctionInput) {
  if (!SANCTION_FOR[i.targetType].includes(i.type)) throw new UserError("نوع العقوبة لا يناسب الجهة المعاقبة");
  if (i.targetType === "PLAYER" && !i.playerId) throw new UserError("اختر اللاعب");
  if (i.targetType === "STAFF" && !i.staffId) throw new UserError("اختر الإداري");
  if (i.type === "MATCH_BAN" && !(i.matchesCount && i.matchesCount > 0)) throw new UserError("حدد عدد مباريات الإيقاف");
  if ((i.type === "TIME_BAN" || i.type === "STADIUM_BAN" || i.type === "REGISTRATION_BAN") && !i.toDate) throw new UserError("حدد تاريخ نهاية العقوبة");
  if (i.type === "POINTS_DEDUCTION" && (!i.points || !i.competitionId)) throw new UserError("حدد عدد النقاط والمسابقة");
  if (i.type === "FORFEIT" && !i.matchId) throw new UserError("الخسارة الاعتبارية تحتاج تحديد المباراة");
  if (i.type === "FINE" && !(Number(i.fineAmount) > 0)) throw new UserError("حدد قيمة الغرامة");
  if (!i.reason?.trim()) throw new UserError("سبب العقوبة مطلوب");
}

async function targetName(tx: Tx, i: { targetType: string; playerId?: number | null; staffId?: number | null; clubId: number }) {
  if (i.targetType === "PLAYER" && i.playerId) return (await tx.select({ n: players.fullName }).from(players).where(eq(players.id, i.playerId)))[0]?.n ?? "";
  if (i.targetType === "STAFF" && i.staffId) return (await tx.select({ n: staff.fullName }).from(staff).where(eq(staff.id, i.staffId)))[0]?.n ?? "";
  return (await tx.select({ n: clubs.name }).from(clubs).where(eq(clubs.id, i.clubId)))[0]?.n ?? "";
}

/** تطبيق آثار العقوبة على المنظومة (إيقاف، غرامة، خسارة اعتبارية) */
async function applyEffects(tx: Tx, id: number, by: string) {
  const [s] = await tx.select().from(sanctions).where(eq(sanctions.id, id));
  const name = await targetName(tx, s);
  let suspensionId: number | null = s.suspensionId;
  if (s.targetType === "PLAYER" && s.playerId && !suspensionId) {
    if (s.type === "MATCH_BAN") {
      const [x] = await tx.insert(suspensions).values({
        playerId: s.playerId, kind: "MATCHES", reason: `قرار ${s.number}: ${s.reason}`, matchesTotal: s.matchesCount, competitionId: s.competitionId,
        sourceMatchId: s.matchId, startDate: s.fromDate ?? s.decisionDate, createdBy: by,
      }).returning();
      suspensionId = x.id;
    } else if (s.type === "TIME_BAN" || s.type === "STADIUM_BAN") {
      const [x] = await tx.insert(suspensions).values({
        playerId: s.playerId, kind: "ADMIN", reason: `قرار ${s.number}: ${s.reason}`, startDate: s.fromDate ?? s.decisionDate, endDate: s.toDate, createdBy: by,
      }).returning();
      suspensionId = x.id;
    }
  }
  let chargeId: number | null = s.chargeId;
  if (Number(s.fineAmount) > 0 && !chargeId) {
    chargeId = await addCharge(tx, { clubId: s.clubId, category: "FINE", description: `قرار ${s.number} — ${name}`, amount: s.fineAmount!, refType: "sanction", refId: s.id, createdBy: by });
  }
  if (s.type === "FORFEIT" && s.matchId) {
    const [m] = await tx.select().from(matches).where(eq(matches.id, s.matchId));
    const homeLoses = m.homeClubId === s.clubId;
    await tx.update(matches).set({ homeScore: homeLoses ? 0 : 3, awayScore: homeLoses ? 3 : 0, status: "FORFEIT", reportStatus: "APPROVED", approvedAt: new Date(), approvedBy: `${by} (قرار ${s.number})` }).where(eq(matches.id, s.matchId));
  }
  await tx.update(sanctions).set({ suspensionId, chargeId }).where(eq(sanctions.id, id));
}

export async function issueSanction(tx: Tx, i: SanctionInput, by: string) {
  validate(i);
  const number = await nextNumber(tx);
  const [cfg] = await tx.select().from(settings).where(eq(settings.key, "appeal_days"));
  const decisionDate = i.decisionDate ?? today();
  const appealDeadline = new Date(new Date(decisionDate).getTime() + Number(cfg?.value ?? 7) * 864e5).toISOString().slice(0, 10);
  const [s] = await tx.insert(sanctions).values({
    number, targetType: i.targetType, playerId: i.targetType === "PLAYER" ? i.playerId : null, staffId: i.targetType === "STAFF" ? i.staffId : null,
    clubId: i.clubId, competitionId: i.competitionId ?? null, matchId: i.matchId ?? null, articleId: i.articleId ?? null, articleText: i.articleText ?? null,
    type: i.type, matchesCount: i.matchesCount ?? null, fromDate: i.fromDate ?? null, toDate: i.toDate ?? null, points: i.points ?? null,
    fineAmount: i.fineAmount ?? null, reason: i.reason, decisionDate, appealDeadline, notes: i.notes ?? null, createdBy: by,
  }).returning();
  await applyEffects(tx, s.id, by);
  const name = await targetName(tx, s);
  await notifyClub(i.clubId, `قرار عقوبة ${number}`, `${SANCTION_TYPE[i.type]} — ${name}: ${i.reason}`, "/club/sanctions", tx);
  return s;
}

/** إلغاء العقوبة وكل آثارها (عند قبول الطعن أو قرار اللجنة) */
export async function revokeSanction(tx: Tx, id: number, by: string) {
  const [s] = await tx.select().from(sanctions).where(eq(sanctions.id, id));
  if (!s) throw new UserError("غير موجود");
  if (s.suspensionId) await tx.update(suspensions).set({ isLifted: true, liftedAt: new Date(), liftedBy: by }).where(eq(suspensions.id, s.suspensionId));
  await cancelChargeByRef(tx, "sanction", id);
  if (s.type === "FORFEIT" && s.matchId) {
    // تعود المباراة لتعتمد لجنة المسابقات نتيجتها من جديد
    await tx.update(matches).set({ homeScore: null, awayScore: null, status: "SCHEDULED", reportStatus: "NONE", approvedAt: null, approvedBy: null }).where(eq(matches.id, s.matchId));
  }
  await tx.update(sanctions).set({ status: "REVOKED" }).where(eq(sanctions.id, id));
}

/** تعديل العقوبة (تخفيف عند قبول الطعن جزئيًا) مع تحديث الإيقاف والغرامة */
export async function amendSanction(tx: Tx, id: number, v: { matchesCount?: number | null; toDate?: string | null; points?: number | null; fineAmount?: string | null }, by: string) {
  const [s] = await tx.select().from(sanctions).where(eq(sanctions.id, id));
  await tx.update(sanctions).set({ matchesCount: v.matchesCount ?? s.matchesCount, toDate: v.toDate ?? s.toDate, points: v.points ?? s.points, fineAmount: v.fineAmount ?? s.fineAmount, status: "ACTIVE" }).where(eq(sanctions.id, id));
  if (s.suspensionId) {
    await tx.update(suspensions).set({ matchesTotal: v.matchesCount ?? undefined, endDate: v.toDate ?? undefined }).where(eq(suspensions.id, s.suspensionId));
  }
  if (v.fineAmount != null && s.chargeId) {
    const [c] = await tx.select().from(charges).where(eq(charges.id, s.chargeId));
    const amt = Number(v.fineAmount);
    const paid = Number(c.paidAmount);
    await tx.update(charges).set({ amount: amt.toFixed(2), status: amt <= 0 ? "CANCELLED" : paid >= amt ? "PAID" : paid > 0 ? "PARTIAL" : "OPEN" }).where(eq(charges.id, s.chargeId));
  } else if (v.fineAmount != null && Number(v.fineAmount) > 0) {
    await applyEffects(tx, id, by);
  }
}

/** النقاط المخصومة لكل نادٍ في مسابقة */
export async function pointsDeducted(competitionId: number) {
  const rows = await db.select({ clubId: sanctions.clubId, pts: sql<number>`coalesce(sum(${sanctions.points}), 0)::int` }).from(sanctions)
    .where(and(eq(sanctions.competitionId, competitionId), eq(sanctions.type, "POINTS_DEDUCTION"), inArray(sanctions.status, ["ACTIVE", "COMPLETED", "APPEALED"])))
    .groupBy(sanctions.clubId);
  return new Map(rows.map((r) => [r.clubId, r.pts]));
}

/** عقوبات سارية على المباراة (دون جمهور / نقل ملعب) لعرضها في صفحة المباراة */
export async function matchNotices(matchId: number) {
  return db.select().from(sanctions).where(and(eq(sanctions.matchId, matchId), inArray(sanctions.type, ["CLOSED_DOORS", "VENUE_CHANGE", "FORFEIT"]), inArray(sanctions.status, ["ACTIVE", "APPEALED", "COMPLETED"])));
}
