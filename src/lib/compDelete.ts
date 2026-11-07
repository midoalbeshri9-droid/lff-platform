import "server-only";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  competitions, competitionTeams, matches, matchEvents, assignments, sanctions, suspensions, charges, payments, appeals, evaluations,
} from "@/db/schema";

const ids = (a: number[]) => (a.length ? a : [-1]);

/** كل ما يتعلق بالمسابقة (للعرض قبل الحذف وللحذف نفسه) */
export async function competitionFootprint(compId: number) {
  const ms = (await db.select({ id: matches.id }).from(matches).where(eq(matches.competitionId, compId))).map((x) => x.id);
  const teams = (await db.select({ id: competitionTeams.id }).from(competitionTeams).where(eq(competitionTeams.competitionId, compId))).map((x) => x.id);
  const sans = (await db.select({ id: sanctions.id }).from(sanctions).where(or(eq(sanctions.competitionId, compId), inArray(sanctions.matchId, ids(ms))))).map((x) => x.id);
  const susp = (await db.select({ id: suspensions.id }).from(suspensions).where(or(eq(suspensions.competitionId, compId), inArray(suspensions.sourceMatchId, ids(ms))))).map((x) => x.id);
  const chs = (await db.select({ id: charges.id }).from(charges).where(or(
    and(eq(charges.refType, "match"), inArray(charges.refId, ids(ms))),
    and(eq(charges.refType, "compteam"), inArray(charges.refId, ids(teams))),
    and(inArray(charges.refType, ["sanction", "sanction_fees"]), inArray(charges.refId, ids(sans))),
  ))).map((x) => x.id);
  const n = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
  const cnt = sql<number>`count(*)::int`;
  return {
    matchIds: ms, teamIds: teams, sanctionIds: sans, suspensionIds: susp, chargeIds: chs,
    counts: {
      matches: ms.length, teams: teams.length,
      played: await n(db.select({ n: cnt }).from(matches).where(and(eq(matches.competitionId, compId), eq(matches.reportStatus, "APPROVED")))),
      events: await n(db.select({ n: cnt }).from(matchEvents).where(inArray(matchEvents.matchId, ids(ms)))),
      assignments: await n(db.select({ n: cnt }).from(assignments).where(inArray(assignments.matchId, ids(ms)))),
      evaluations: await n(db.select({ n: cnt }).from(evaluations).where(inArray(evaluations.matchId, ids(ms)))),
      sanctions: sans.length, suspensions: susp.length, charges: chs.length,
      appeals: await n(db.select({ n: cnt }).from(appeals).where(inArray(appeals.sanctionId, ids(sans)))),
      payments: await n(db.select({ n: cnt }).from(payments).where(and(inArray(payments.chargeId, ids(chs)), eq(payments.isVoided, false)))),
    },
  };
}

/** حذف المسابقة نهائيًا مع كل آثارها — يرفض إن وُجدت دفعات مالية مسجلة على مستحقاتها */
export async function deleteCompetitionCascade(compId: number) {
  const f = await competitionFootprint(compId);
  if (f.counts.payments) throw new Error(`PAYMENTS:${f.counts.payments}`); // دفعات سارية: تُلغى من المالية أولًا
  await db.transaction(async (tx) => {
    // الترتيب مهم: الطعون والقرارات قبل الإيقافات (القرار يشير للإيقاف)، والمستحقات قبل الكل، ثم المسابقة (تحذف تلقائيًا المراحل والفرق والمباريات وأحداثها وتعييناتها وتقاريرها)
    if (f.chargeIds.length) {
      await tx.delete(payments).where(and(inArray(payments.chargeId, f.chargeIds), eq(payments.isVoided, true))); // دفعات ملغاة فقط
      await tx.delete(charges).where(inArray(charges.id, f.chargeIds));
    }
    if (f.sanctionIds.length) await tx.delete(sanctions).where(inArray(sanctions.id, f.sanctionIds)); // الطعون تُحذف معها تلقائيًا
    if (f.suspensionIds.length) await tx.delete(suspensions).where(inArray(suspensions.id, f.suspensionIds));
    await tx.delete(competitions).where(eq(competitions.id, compId));
  });
  return f.counts;
}
