import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { matches, competitions, clubs, seasons, stadiums, assignments, officials, registrations, players, ageCategories, matchSquads, matchReportForms } from "@/db/schema";
import { OFFICIAL_GRADE } from "./labels";
import type { EvalRole } from "./observerForm";

export type SquadOpt = { id: number; name: string; cardNo: string; clubId: number; shirt: number | null };

/** بيانات الصفحة الأولى من تقرير المراقب (تُعبأ تلقائيًا من المنظومة) + قوائم اللاعبين للاختيار */
export async function observerContext(matchId: number) {
  const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
  if (!m) return null;
  const [c] = await db.select().from(competitions).where(eq(competitions.id, m.competitionId));
  const [season] = await db.select().from(seasons).where(eq(seasons.id, c.seasonId));
  const [cat] = c.categoryId ? await db.select().from(ageCategories).where(eq(ageCategories.id, c.categoryId)) : [];
  const [st] = m.stadiumId ? await db.select().from(stadiums).where(eq(stadiums.id, m.stadiumId)) : [];
  const cl = await db.select({ id: clubs.id, name: clubs.name }).from(clubs).where(inArray(clubs.id, [m.homeClubId, m.awayClubId]));
  const clubName = (id: number) => cl.find((x) => x.id === id)?.name ?? "";
  const crew = await db.select({ role: assignments.role, id: officials.id, name: officials.fullName, grade: officials.grade }).from(assignments)
    .innerJoin(officials, eq(officials.id, assignments.officialId))
    .where(and(eq(assignments.matchId, matchId), eq(assignments.status, "APPROVED")));
  const person = (role: string) => { const x = crew.find((r) => r.role === role); return x ? { id: x.id, name: x.name, grade: OFFICIAL_GRADE[x.grade] ?? "" } : null; };
  // رقم المباراة بالجدول: ترتيبها بين مباريات الجولة نفسها
  const sameRound = await db.select({ id: matches.id }).from(matches)
    .where(and(eq(matches.competitionId, m.competitionId), m.stageId ? eq(matches.stageId, m.stageId) : undefined, eq(matches.round, m.round ?? 0)))
    .orderBy(asc(matches.kickoff), asc(matches.id));
  const no = sameRound.findIndex((x) => x.id === m.id) + 1;
  // اللاعبون: قائمة المباراة إن أُدخلت، وإلا المقيدون المعتمدون للفريقين في موسم المسابقة
  const sq = await db.select({ id: players.id, name: players.fullName, cardNo: players.cardNo, clubId: matchSquads.clubId, shirt: matchSquads.shirtNumber })
    .from(matchSquads).innerJoin(players, eq(players.id, matchSquads.playerId)).where(eq(matchSquads.matchId, matchId));
  const fromSquad = new Set(sq.map((x) => x.clubId));
  const missing = [m.homeClubId, m.awayClubId].filter((id) => !fromSquad.has(id));
  const reg = missing.length ? await db.select({ id: players.id, name: players.fullName, cardNo: players.cardNo, clubId: registrations.clubId, shirt: registrations.shirtNumber })
    .from(registrations).innerJoin(players, eq(players.id, registrations.playerId))
    .where(and(inArray(registrations.clubId, missing), eq(registrations.seasonId, c.seasonId), eq(registrations.status, "APPROVED"))) : [];
  const squad: SquadOpt[] = [...sq, ...reg].map((x) => ({ ...x, cardNo: x.cardNo ?? "" }))
    .sort((a, b) => (a.shirt ?? 999) - (b.shirt ?? 999) || a.name.localeCompare(b.name, "ar"));
  const observer = person("COMMISSIONER");
  return {
    m, comp: c.name, season: season?.name ?? "", category: cat?.name ?? "الفريق الأول", round: m.round, no,
    home: { id: m.homeClubId, name: clubName(m.homeClubId) }, away: { id: m.awayClubId, name: clubName(m.awayClubId) },
    stadium: st?.name ?? m.venue ?? "", observer,
    crew: { REFEREE: person("REFEREE"), AR1: person("AR1"), AR2: person("AR2"), FOURTH: person("FOURTH") } as Record<EvalRole, { id: number; name: string; grade: string } | null>,
    squad,
  };
}
export type ObserverCtx = NonNullable<Awaited<ReturnType<typeof observerContext>>>;

export async function observerForm(matchId: number) {
  const [r] = await db.select().from(matchReportForms).where(and(eq(matchReportForms.matchId, matchId), eq(matchReportForms.kind, "COMMISSIONER")));
  return r ?? null;
}
