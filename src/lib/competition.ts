import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { competitions, matches, matchEvents, suspensions, clubs, registrations, stageTeams } from "@/db/schema";
import { UserError } from "./util";
import { roundRobin } from "./competitionPure";
import { ensureStages, generateStageFixtures } from "./stages";
import { pointsDeducted } from "./sanctions";
import { refereeFeesForMatch } from "./finance";
export { roundRobin };

/** إنشاء جدول المسابقة كاملًا (المرحلة الأولى غير المجدولة) — للتوافق مع الزر القديم */
export async function generateFixtures(competitionId: number) {
  const stages = await ensureStages(competitionId);
  const st = stages.find((x) => x.status !== "DONE") ?? stages[0];
  return generateStageFixtures(st.id);
}

export type StandingRow = { clubId: number; name: string; group: string | null; p: number; w: number; d: number; l: number; gf: number; ga: number; gd: number; pts: number; deducted: number };

type MRow = typeof matches.$inferSelect;

function tally(rows: Map<number, StandingRow>, ms: MRow[], win: number, draw: number) {
  for (const m of ms) {
    if (m.homeScore == null || m.awayScore == null) continue;
    const h = rows.get(m.homeClubId), a = rows.get(m.awayClubId);
    if (!h || !a) continue;
    h.p++; a.p++;
    h.gf += m.homeScore; h.ga += m.awayScore; a.gf += m.awayScore; a.ga += m.homeScore;
    if (m.homeScore > m.awayScore) { h.w++; a.l++; h.pts += win; }
    else if (m.homeScore < m.awayScore) { a.w++; h.l++; a.pts += win; }
    else { h.d++; a.d++; h.pts += draw; a.pts += draw; }
  }
}

/**
 * جدول الترتيب لمرحلة (دوري أو مجموعات). بدون stageId: أول مرحلة دوري/مجموعات غير منتهية، وإلا آخر واحدة.
 * كسر التعادل: GD = النقاط ← فارق الأهداف ← الأهداف ← المواجهات المباشرة. H2H = النقاط ← المواجهات المباشرة ← فارق الأهداف ← الأهداف.
 */
export async function standings(competitionId: number, stageId?: number): Promise<StandingRow[]> {
  const [c] = await db.select().from(competitions).where(eq(competitions.id, competitionId));
  const stages = await ensureStages(competitionId);
  const tableStages = stages.filter((x) => x.format !== "KNOCKOUT");
  const st = stageId ? stages.find((x) => x.id === stageId) : tableStages.find((x) => x.status !== "DONE") ?? tableStages[tableStages.length - 1];
  if (!st || st.format === "KNOCKOUT") return [];
  const teams = await db
    .select({ clubId: stageTeams.clubId, name: clubs.name, group: stageTeams.groupName })
    .from(stageTeams).innerJoin(clubs, eq(clubs.id, stageTeams.clubId))
    .where(eq(stageTeams.stageId, st.id));
  const ms = await db.select().from(matches)
    .where(and(eq(matches.stageId, st.id), inArray(matches.status, ["PLAYED", "FORFEIT"])));
  const t = new Map<number, StandingRow>();
  teams.forEach((x) => t.set(x.clubId, { clubId: x.clubId, name: x.name, group: st.format === "GROUPS" ? x.group : null, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0, deducted: 0 }));
  tally(t, ms, c.pointsWin, c.pointsDraw);
  const ded = await pointsDeducted(competitionId, st.id, tableStages[0]?.id === st.id);
  const rows = [...t.values()].map((r) => ({ ...r, gd: r.gf - r.ga, deducted: ded.get(r.clubId) ?? 0, pts: r.pts - (ded.get(r.clubId) ?? 0) }));

  // المواجهات المباشرة بين الفرق المتساوية في النقاط داخل المجموعة نفسها
  const h2h = new Map<number, { pts: number; gd: number; gf: number }>();
  const byKey = new Map<string, StandingRow[]>();
  for (const r of rows) { const k = `${r.group ?? ""}|${r.pts}`; byKey.set(k, [...(byKey.get(k) ?? []), r]); }
  for (const tied of byKey.values()) {
    if (tied.length < 2) continue;
    const ids = new Set(tied.map((x) => x.clubId));
    const mini = new Map<number, StandingRow>();
    tied.forEach((x) => mini.set(x.clubId, { ...x, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 }));
    tally(mini, ms.filter((m) => ids.has(m.homeClubId) && ids.has(m.awayClubId)), c.pointsWin, c.pointsDraw);
    mini.forEach((v, k) => h2h.set(k, { pts: v.pts, gd: v.gf - v.ga, gf: v.gf }));
  }
  const H = (r: StandingRow) => h2h.get(r.clubId) ?? { pts: 0, gd: 0, gf: 0 };
  const byH2H = (x: StandingRow, y: StandingRow) => H(y).pts - H(x).pts || H(y).gd - H(x).gd || H(y).gf - H(x).gf;
  const byGoals = (x: StandingRow, y: StandingRow) => y.gd - x.gd || y.gf - x.gf;
  return rows.sort((x, y) =>
    (x.group ?? "").localeCompare(y.group ?? "", "ar") || y.pts - x.pts ||
    (c.tiebreak === "H2H" ? byH2H(x, y) || byGoals(x, y) : byGoals(x, y) || byH2H(x, y)) ||
    x.name.localeCompare(y.name, "ar"));
}

/**
 * اعتماد تقرير المباراة من لجنة المسابقات:
 * 1) احتساب النتيجة من الأهداف  2) احتساب مباراة مقضية للموقوفين من الناديين
 * 3) إيقاف تلقائي للطرد وتراكم الإنذارات
 */
export async function approveMatch(tx: Tx, matchId: number, by: string) {
  const [m] = await tx.select().from(matches).where(eq(matches.id, matchId));
  if (!m) throw new UserError("المباراة غير موجودة");
  if (m.reportStatus === "APPROVED") throw new UserError("التقرير معتمد مسبقًا");
  const [c] = await tx.select().from(competitions).where(eq(competitions.id, m.competitionId));
  const evs = await tx.select().from(matchEvents).where(eq(matchEvents.matchId, matchId));

  const goals = (club: number) =>
    evs.filter((e) => (["GOAL", "PENALTY_GOAL"].includes(e.type) && e.clubId === club) || (e.type === "OWN_GOAL" && e.clubId !== club)).length;
  const home = m.homeScore ?? goals(m.homeClubId);
  const away = m.awayScore ?? goals(m.awayClubId);

  // (2) قضاء مباراة لكل لاعب موقوف من الناديين (إيقاف سابق لهذه المباراة)
  const clubPlayers = await tx
    .select({ playerId: registrations.playerId })
    .from(registrations)
    .where(and(inArray(registrations.clubId, [m.homeClubId, m.awayClubId]), eq(registrations.seasonId, c.seasonId), eq(registrations.status, "APPROVED")));
  const pids = clubPlayers.map((x) => x.playerId);
  if (pids.length) {
    const open = await tx
      .select()
      .from(suspensions)
      .where(and(inArray(suspensions.playerId, pids), eq(suspensions.kind, "MATCHES"), eq(suspensions.isLifted, false)));
    for (const s of open) {
      if (s.sourceMatchId === matchId) continue;
      if (s.competitionId && s.competitionId !== m.competitionId) continue;
      if ((s.matchesTotal ?? 0) <= s.matchesServed) continue;
      await tx.update(suspensions).set({ matchesServed: s.matchesServed + 1 }).where(eq(suspensions.id, s.id));
    }
  }

  // (3) إيقافات تلقائية
  const created: string[] = [];
  const sentOff = new Set<number>();
  for (const e of evs.filter((e) => (e.type === "RED" || e.type === "SECOND_YELLOW") && e.playerId)) {
    if (sentOff.has(e.playerId!)) continue;
    sentOff.add(e.playerId!);
    await tx.insert(suspensions).values({
      playerId: e.playerId!, kind: "MATCHES", reason: e.type === "RED" ? "طرد مباشر" : "إنذار ثانٍ (طرد)",
      matchesTotal: e.type === "RED" ? c.redBanMatches : 1, competitionId: c.id, sourceMatchId: matchId,
      isAutomatic: true, createdBy: by,
    });
    created.push(`طرد لاعب #${e.playerId}`);
  }
  const yellowsHere = evs.filter((e) => e.type === "YELLOW" && e.playerId && !sentOff.has(e.playerId));
  for (const e of yellowsHere) {
    // مجموع الإنذارات في المسابقة بعد هذه المباراة (المباريات المعتمدة + هذه)
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(matchEvents)
      .innerJoin(matches, eq(matches.id, matchEvents.matchId))
      .where(and(eq(matchEvents.playerId, e.playerId!), eq(matchEvents.type, "YELLOW"), eq(matches.competitionId, c.id),
        sql`(${matches.reportStatus} = 'APPROVED' or ${matches.id} = ${matchId})`));
    // مستويات الإنذارات (مثال "3:1,5:2,7:3") أو حد ثابت متكرر
    const rules = (c.yellowRules ?? "").split(",").map((x) => x.split(":").map(Number)).filter((x) => x.length === 2 && x[0] > 0 && x[1] > 0);
    const rule = rules.find((x) => x[0] === n);
    const ban = rules.length ? rule?.[1] ?? 0 : c.yellowThreshold > 0 && n % c.yellowThreshold === 0 ? 1 : 0;
    if (ban > 0) {
      await tx.insert(suspensions).values({
        playerId: e.playerId!, kind: "MATCHES", reason: `تراكم ${n} إنذارات`, matchesTotal: ban,
        competitionId: c.id, sourceMatchId: matchId, isAutomatic: true, createdBy: by,
      });
      created.push(`تراكم إنذارات للاعب #${e.playerId}`);
    }
  }

  await tx.update(matches)
    .set({ homeScore: home, awayScore: away, status: "PLAYED", reportStatus: "APPROVED", approvedAt: new Date(), approvedBy: by })
    .where(eq(matches.id, matchId));
  await refereeFeesForMatch(tx, matchId, by);
  return { home, away, suspensions: created.length };
}

/** هدّافو المسابقة */
export async function topScorers(competitionId: number, limit = 15) {
  return db
    .select({ playerId: matchEvents.playerId, name: sql<string>`max(p.full_name)`, club: sql<string>`max(c.name)`, goals: sql<number>`count(*)::int` })
    .from(matchEvents)
    .innerJoin(matches, eq(matches.id, matchEvents.matchId))
    .innerJoin(sql`players p`, sql`p.id = ${matchEvents.playerId}`)
    .innerJoin(sql`clubs c`, sql`c.id = ${matchEvents.clubId}`)
    .where(and(eq(matches.competitionId, competitionId), eq(matches.reportStatus, "APPROVED"), inArray(matchEvents.type, ["GOAL", "PENALTY_GOAL"])))
    .groupBy(matchEvents.playerId)
    .orderBy(sql`count(*) desc`)
    .limit(limit);
}


/** الأجانب داخل الملعب: الأساسيون الأجانب + الداخلون − الخارجون − المطرودون */
export async function foreignOnPitchCheck(matchId: number, clubId: number, incomingPlayerId: number) {
  const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
  const [c] = await db.select().from(competitions).where(eq(competitions.id, m.competitionId));
  if (c.maxForeignOnPitch == null) return;
  const { matchSquads, players } = await import("@/db/schema");
  const squad = await db.select({ pid: matchSquads.playerId, starter: matchSquads.isStarter, foreign: players.isForeign })
    .from(matchSquads).innerJoin(players, eq(players.id, matchSquads.playerId)).where(and(eq(matchSquads.matchId, matchId), eq(matchSquads.clubId, clubId)));
  const isF = (pid: number | null) => !!squad.find((x) => x.pid === pid)?.foreign;
  if (!isF(incomingPlayerId)) return;
  const evs = await db.select().from(matchEvents).where(and(eq(matchEvents.matchId, matchId), eq(matchEvents.clubId, clubId)));
  const on = new Set(squad.filter((x) => x.starter).map((x) => x.pid));
  for (const e of evs.sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0) || a.id - b.id)) {
    if (!e.playerId) continue;
    if (e.type === "SUB_IN") on.add(e.playerId);
    if (e.type === "SUB_OUT" || e.type === "RED" || e.type === "SECOND_YELLOW") on.delete(e.playerId);
  }
  const foreignNow = [...on].filter((pid) => isF(pid)).length;
  if (foreignNow + 1 > c.maxForeignOnPitch) throw new UserError(`لا يمكن دخول لاعب أجنبي: داخل الملعب ${foreignNow} أجانب والحد ${c.maxForeignOnPitch} — سجّل خروج أجنبي أولًا`);
}
