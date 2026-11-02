import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { competitions, competitionTeams, matches, matchEvents, suspensions, clubs, registrations } from "@/db/schema";
import { UserError } from "./util";
import { roundRobin } from "./competitionPure";
import { pointsDeducted } from "./sanctions";
import { refereeFeesForMatch } from "./finance";
export { roundRobin };

export async function generateFixtures(competitionId: number) {
  const [c] = await db.select().from(competitions).where(eq(competitions.id, competitionId));
  const teams = await db.select().from(competitionTeams).where(eq(competitionTeams.competitionId, competitionId));
  if (teams.length < 2) throw new UserError("أضف فريقين على الأقل قبل الجدولة");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(matches).where(eq(matches.competitionId, competitionId));
  if (n > 0) throw new UserError("الجدول مُنشأ مسبقًا — احذف المباريات أولًا لإعادة الجدولة");
  const clubRows = await db.select({ id: clubs.id, stadium: clubs.stadium, city: clubs.city }).from(clubs);
  const venue = (id: number) => clubRows.find((x) => x.id === id);

  const rows: (typeof matches.$inferInsert)[] = [];
  if (c.type === "GROUPS") {
    const groups = [...new Set(teams.map((t) => t.groupName ?? "أ"))];
    for (const g of groups) {
      const ids = teams.filter((t) => (t.groupName ?? "أ") === g).map((t) => t.clubId);
      roundRobin(ids, c.legs).forEach((m) =>
        rows.push({ competitionId, round: m.round, groupName: g, homeClubId: m.home, awayClubId: m.away, venue: venue(m.home)?.stadium, city: venue(m.home)?.city }),
      );
    }
  } else if (c.type === "CUP") {
    const ids = teams.map((t) => t.clubId).sort(() => Math.random() - 0.5);
    for (let i = 0; i + 1 < ids.length; i += 2)
      rows.push({ competitionId, round: 1, homeClubId: ids[i], awayClubId: ids[i + 1], venue: venue(ids[i])?.stadium, city: venue(ids[i])?.city });
  } else {
    roundRobin(teams.map((t) => t.clubId), c.legs).forEach((m) =>
      rows.push({ competitionId, round: m.round, homeClubId: m.home, awayClubId: m.away, venue: venue(m.home)?.stadium, city: venue(m.home)?.city }),
    );
  }
  if (rows.length) await db.insert(matches).values(rows);
  return rows.length;
}

export type StandingRow = { clubId: number; name: string; group: string | null; p: number; w: number; d: number; l: number; gf: number; ga: number; gd: number; pts: number; deducted: number };

export async function standings(competitionId: number): Promise<StandingRow[]> {
  const [c] = await db.select().from(competitions).where(eq(competitions.id, competitionId));
  const teams = await db
    .select({ clubId: competitionTeams.clubId, name: clubs.name, group: competitionTeams.groupName })
    .from(competitionTeams)
    .innerJoin(clubs, eq(clubs.id, competitionTeams.clubId))
    .where(eq(competitionTeams.competitionId, competitionId));
  const ms = await db
    .select()
    .from(matches)
    .where(and(eq(matches.competitionId, competitionId), inArray(matches.status, ["PLAYED", "FORFEIT"])));
  const t = new Map<number, StandingRow>();
  teams.forEach((x) => t.set(x.clubId, { clubId: x.clubId, name: x.name, group: x.group, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0, deducted: 0 }));
  for (const m of ms) {
    if (m.homeScore == null || m.awayScore == null) continue;
    const h = t.get(m.homeClubId), a = t.get(m.awayClubId);
    if (!h || !a) continue;
    h.p++; a.p++;
    h.gf += m.homeScore; h.ga += m.awayScore; a.gf += m.awayScore; a.ga += m.homeScore;
    if (m.homeScore > m.awayScore) { h.w++; a.l++; h.pts += c.pointsWin; }
    else if (m.homeScore < m.awayScore) { a.w++; h.l++; a.pts += c.pointsWin; }
    else { h.d++; a.d++; h.pts += c.pointsDraw; a.pts += c.pointsDraw; }
  }
  const ded = await pointsDeducted(competitionId);
  return [...t.values()]
    .map((r) => ({ ...r, gd: r.gf - r.ga, deducted: ded.get(r.clubId) ?? 0, pts: r.pts - (ded.get(r.clubId) ?? 0) }))
    .sort((x, y) => (x.group ?? "").localeCompare(y.group ?? "") || y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || x.name.localeCompare(y.name, "ar"));
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
