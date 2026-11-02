import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { competitions, competitionStages, stageTeams, competitionTeams, matches, clubs } from "@/db/schema";
import { UserError } from "./util";
import { roundRobin, koPairs, koRoundName, tieWinner, GROUP_LETTERS } from "./competitionPure";

export type Stage = typeof competitionStages.$inferSelect;
type CompType = (typeof competitions.$inferSelect)["type"];

export const STAGE_FORMAT: Record<string, string> = { LEAGUE: "دوري", GROUPS: "مجموعات", KNOCKOUT: "خروج المغلوب" };
export const STAGE_STATUS: Record<string, [string, string]> = { PENDING: ["لم تبدأ", "b-gray"], ACTIVE: ["جارية", "b-green"], DONE: ["انتهت", "b-blue"] };

/** المراحل الافتراضية حسب نظام المسابقة عند إنشائها */
export function templateStages(type: CompType, legs: number, opts: { groupsCount?: number | null; qualifyPerGroup?: number | null; koLegs?: number | null } = {}) {
  const g = opts.groupsCount ?? 2, q = opts.qualifyPerGroup ?? 2, ko = opts.koLegs ?? 1;
  switch (type) {
    case "GROUPS": return [{ seq: 1, name: "دور المجموعات", format: "GROUPS" as const, legs, groupsCount: g, qualifyPerGroup: q }];
    case "CUP": return [{ seq: 1, name: "خروج المغلوب", format: "KNOCKOUT" as const, legs: ko, finalLegs: 1 }];
    case "GROUPS_KNOCKOUT": return [
      { seq: 1, name: "دور المجموعات", format: "GROUPS" as const, legs, groupsCount: g, qualifyPerGroup: q },
      { seq: 2, name: "الأدوار الإقصائية", format: "KNOCKOUT" as const, legs: ko, finalLegs: 1 },
    ];
    default: return [{ seq: 1, name: "الدوري", format: "LEAGUE" as const, legs }];
  }
}

export async function createStagesFor(competitionId: number) {
  const [c] = await db.select().from(competitions).where(eq(competitions.id, competitionId));
  const rows = templateStages(c.type, c.legs).map((x, i) => ({ ...x, competitionId, status: (i === 0 ? "ACTIVE" : "PENDING") as "ACTIVE" }));
  return db.insert(competitionStages).values(rows).returning();
}

/** يضمن وجود مراحل للمسابقة (المسابقات القديمة تُحوَّل إلى مرحلة واحدة تلقائيًا) */
export async function ensureStages(competitionId: number): Promise<Stage[]> {
  let st = await db.select().from(competitionStages).where(eq(competitionStages.competitionId, competitionId)).orderBy(asc(competitionStages.seq));
  if (st.length) return st;
  await createStagesFor(competitionId);
  st = await db.select().from(competitionStages).where(eq(competitionStages.competitionId, competitionId)).orderBy(asc(competitionStages.seq));
  const first = st[0];
  const teams = await db.select().from(competitionTeams).where(eq(competitionTeams.competitionId, competitionId));
  if (teams.length) await db.insert(stageTeams).values(teams.map((t) => ({ stageId: first.id, clubId: t.clubId, groupName: t.groupName }))).onConflictDoNothing();
  await db.update(matches).set({ stageId: first.id }).where(and(eq(matches.competitionId, competitionId), isNull(matches.stageId)));
  return st;
}

export async function getStage(stageId: number) {
  const [s] = await db.select().from(competitionStages).where(eq(competitionStages.id, stageId));
  if (!s) throw new UserError("المرحلة غير موجودة");
  return s;
}

async function stageHasMatches(stageId: number) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(matches).where(eq(matches.stageId, stageId));
  return n > 0;
}

/** عند إضافة فرق للمسابقة: تدخل المرحلة الأولى ما دامت لم تُجدول */
export async function addToFirstStage(competitionId: number, clubIds: number[], groupName: string | null) {
  const [first] = await ensureStages(competitionId);
  if (await stageHasMatches(first.id)) return false;
  if (clubIds.length) await db.insert(stageTeams).values(clubIds.map((clubId) => ({ stageId: first.id, clubId, groupName }))).onConflictDoNothing();
  return true;
}

export async function removeFromStages(competitionId: number, clubId: number) {
  const st = await ensureStages(competitionId);
  await db.delete(stageTeams).where(and(inArray(stageTeams.stageId, st.map((x) => x.id)), eq(stageTeams.clubId, clubId)));
}

/** قرعة المجموعات: عشوائية، أو بالتصنيف (المستوى الأول يتوزع أولًا على المجموعات) */
export async function drawGroups(stageId: number, count: number, seededOrder?: number[]) {
  const s = await getStage(stageId);
  if (s.format !== "GROUPS") throw new UserError("القرعة لمراحل المجموعات فقط");
  if (await stageHasMatches(stageId)) throw new UserError("المرحلة مجدولة — احذف جدولها أولًا");
  if (!(count >= 2 && count <= GROUP_LETTERS.length)) throw new UserError("عدد المجموعات بين 2 و 12");
  const teams = await db.select().from(stageTeams).where(eq(stageTeams.stageId, stageId));
  if (teams.length < count * 2) throw new UserError("عدد الفرق لا يكفي لهذا العدد من المجموعات (فريقان على الأقل لكل مجموعة)");
  let ids = teams.map((t) => t.clubId);
  if (seededOrder?.length) {
    const ranked = seededOrder.filter((id) => ids.includes(id));
    const rest = ids.filter((id) => !ranked.includes(id)).sort(() => Math.random() - 0.5);
    ids = [...ranked, ...rest];
    // كل "مستوى" (عدد المجموعات) يُخلط داخله ليبقى التوزيع عادلًا
    const pots: number[][] = [];
    for (let i = 0; i < ids.length; i += count) pots.push(ids.slice(i, i + count).sort(() => Math.random() - 0.5));
    ids = pots.flat();
  } else ids.sort(() => Math.random() - 0.5);
  for (let i = 0; i < ids.length; i++) {
    const g = GROUP_LETTERS[i % count];
    await db.update(stageTeams).set({ groupName: g }).where(and(eq(stageTeams.stageId, stageId), eq(stageTeams.clubId, ids[i])));
  }
  await db.update(competitionStages).set({ groupsCount: count }).where(eq(competitionStages.id, stageId));
}

export async function setGroups(stageId: number, groups: Map<number, string | null>) {
  if (await stageHasMatches(stageId)) throw new UserError("المرحلة مجدولة — احذف جدولها أولًا");
  for (const [clubId, g] of groups) await db.update(stageTeams).set({ groupName: g }).where(and(eq(stageTeams.stageId, stageId), eq(stageTeams.clubId, clubId)));
}

async function venues() {
  const rows = await db.select({ id: clubs.id, stadium: clubs.stadium, city: clubs.city }).from(clubs);
  return (id: number) => rows.find((x) => x.id === id);
}

function koMatches(competitionId: number, stageId: number, round: number, pairs: [number, number][], legs: number, venue: (id: number) => { stadium: string | null; city: string | null } | undefined, startTie = 1) {
  const rows: (typeof matches.$inferInsert)[] = [];
  pairs.forEach(([a, b], i) => {
    rows.push({ competitionId, stageId, round, tieNo: startTie + i, leg: 1, homeClubId: a, awayClubId: b, venue: venue(a)?.stadium, city: venue(a)?.city });
    if (legs >= 2) rows.push({ competitionId, stageId, round, tieNo: startTie + i, leg: 2, homeClubId: b, awayClubId: a, venue: venue(b)?.stadium, city: venue(b)?.city });
  });
  return rows;
}

/** إنشاء جدول مرحلة */
export async function generateStageFixtures(stageId: number) {
  const s = await getStage(stageId);
  if (await stageHasMatches(stageId)) throw new UserError("جدول هذه المرحلة مُنشأ مسبقًا — احذفه أولًا لإعادة الجدولة");
  const teams = await db.select().from(stageTeams).where(eq(stageTeams.stageId, stageId));
  if (teams.length < 2) throw new UserError("أضف فريقين على الأقل لهذه المرحلة قبل الجدولة");
  if (s.seq === 1 && s.format !== "KNOCKOUT") {
    // م19: لا تُنظم مسابقة بأقل من 5 فرق (4 للفئات السنية)
    const [c] = await db.select().from(competitions).where(eq(competitions.id, s.competitionId));
    const min = c.categoryId ? 4 : 5;
    if (teams.length < min) throw new UserError(`لا يجوز تنظيم المسابقة بأقل من ${min} فرق (م19 من لائحة المسابقات) — عدد الفرق ${teams.length}`);
  }
  const venue = await venues();
  const rows: (typeof matches.$inferInsert)[] = [];
  if (s.format === "GROUPS") {
    if (teams.some((t) => !t.groupName)) throw new UserError("وزّع كل الفرق على المجموعات أولًا (قرعة أو يدويًا)");
    const groups = [...new Set(teams.map((t) => t.groupName!))];
    for (const g of groups) {
      const ids = teams.filter((t) => t.groupName === g).map((t) => t.clubId);
      if (ids.length < 2) throw new UserError(`المجموعة ${g} فيها فريق واحد`);
      roundRobin(ids, s.legs).forEach((m) => rows.push({ competitionId: s.competitionId, stageId, round: m.round, groupName: g, homeClubId: m.home, awayClubId: m.away, venue: venue(m.home)?.stadium, city: venue(m.home)?.city }));
    }
  } else if (s.format === "KNOCKOUT") {
    if (teams.length % 2) throw new UserError(`عدد الفرق فردي (${teams.length}) — أضف أو احذف فريقًا، أو أضف المباريات يدويًا`);
    const legs = teams.length === 2 ? s.finalLegs : s.legs;
    rows.push(...koMatches(s.competitionId, stageId, 1, koPairs(teams), legs, venue));
  } else {
    roundRobin(teams.map((t) => t.clubId), s.legs).forEach((m) => rows.push({ competitionId: s.competitionId, stageId, round: m.round, homeClubId: m.home, awayClubId: m.away, venue: venue(m.home)?.stadium, city: venue(m.home)?.city }));
  }
  if (rows.length) await db.insert(matches).values(rows);
  await db.update(competitionStages).set({ status: "ACTIVE" }).where(eq(competitionStages.id, stageId));
  return rows.length;
}

export async function clearStageFixtures(stageId: number) {
  const played = await db.select({ id: matches.id }).from(matches).where(and(eq(matches.stageId, stageId), sql`${matches.reportStatus} <> 'NONE'`)).limit(1);
  if (played.length) throw new UserError("توجد مباريات لها تقارير في هذه المرحلة — لا يمكن حذف الجدول");
  await db.delete(matches).where(eq(matches.stageId, stageId));
}

export type Tie = { tieNo: number; legs: (typeof matches.$inferSelect)[]; a: number; b: number; winner: number | null };
export type KoRound = { round: number; name: string; ties: Tie[] };

/** أدوار خروج المغلوب ومواجهاتها والفائز في كل منها */
export async function knockoutRounds(stageId: number): Promise<KoRound[]> {
  const ms = await db.select().from(matches).where(eq(matches.stageId, stageId)).orderBy(asc(matches.round), asc(matches.tieNo), asc(matches.leg), asc(matches.id));
  const rounds = [...new Set(ms.map((m) => m.round))];
  return rounds.map((r) => {
    const inRound = ms.filter((m) => m.round === r);
    const tieNos = [...new Set(inRound.map((m) => m.tieNo ?? -m.id))];
    const ties = tieNos.map((no) => {
      const legs = inRound.filter((m) => (m.tieNo ?? -m.id) === no);
      return { tieNo: no, legs, a: legs[0].homeClubId, b: legs[0].awayClubId, winner: tieWinner(legs) };
    });
    return { round: r, name: koRoundName(ties.length * 2, r), ties };
  });
}

/** إنشاء الدور التالي في خروج المغلوب من الفائزين (الفائز 1 × الفائز 2 ...) */
export async function nextKnockoutRound(stageId: number) {
  const s = await getStage(stageId);
  if (s.format !== "KNOCKOUT") throw new UserError("هذا الإجراء لمراحل خروج المغلوب فقط");
  const rounds = await knockoutRounds(stageId);
  const last = rounds[rounds.length - 1];
  if (!last) throw new UserError("أنشئ الدور الأول أولًا");
  const undecided = last.ties.filter((t) => t.winner == null);
  if (undecided.length) throw new UserError(`${undecided.length} مواجهة لم تُحسم بعد (اعتماد النتائج، أو ركلات الترجيح عند التعادل)`);
  const winners = last.ties.map((t) => t.winner!);
  if (winners.length === 1) {
    await db.update(competitionStages).set({ status: "DONE" }).where(eq(competitionStages.id, stageId));
    return { champion: winners[0], created: 0 };
  }
  if (winners.length % 2) throw new UserError("عدد الفائزين فردي — أضف مباريات الدور التالي يدويًا");
  const pairs: [number, number][] = [];
  for (let i = 0; i < winners.length; i += 2) pairs.push([winners[i], winners[i + 1]]);
  const legs = pairs.length === 1 ? s.finalLegs : s.legs;
  const rows = koMatches(s.competitionId, stageId, last.round + 1, pairs, legs, await venues());
  await db.insert(matches).values(rows);
  return { champion: null, created: rows.length, name: koRoundName(pairs.length * 2, last.round + 1) };
}

/** بطل خروج المغلوب (إن حُسم النهائي) */
export async function koChampion(stageId: number) {
  const rounds = await knockoutRounds(stageId);
  const last = rounds[rounds.length - 1];
  return last && last.ties.length === 1 ? last.ties[0].winner : null;
}

/** تأهيل أفضل الفرق من مرحلة دوري/مجموعات إلى المرحلة التالية */
export async function qualifyToNext(stageId: number, perGroup: number, standingsFn: (competitionId: number, stageId: number) => Promise<{ clubId: number; group: string | null }[]>) {
  const s = await getStage(stageId);
  if (s.format === "KNOCKOUT") throw new UserError("في خروج المغلوب استخدم «إنشاء الدور التالي»");
  const [next] = await db.select().from(competitionStages).where(and(eq(competitionStages.competitionId, s.competitionId), eq(competitionStages.seq, s.seq + 1)));
  if (!next) throw new UserError("لا توجد مرحلة تالية — أضفها أولًا من «إضافة مرحلة»");
  if (await stageHasMatches(next.id)) throw new UserError("المرحلة التالية مجدولة مسبقًا — احذف جدولها لإعادة التأهيل");
  const pending = await db.select({ id: matches.id }).from(matches).where(and(eq(matches.stageId, stageId), inArray(matches.status, ["SCHEDULED", "POSTPONED"]))).limit(1);
  if (pending.length) throw new UserError("توجد مباريات لم تُلعب أو لم تُعتمد في هذه المرحلة");
  if (!(perGroup >= 1)) throw new UserError("حدد عدد المتأهلين");
  const rows = await standingsFn(s.competitionId, stageId);
  const groups = [...new Set(rows.map((r) => r.group ?? ""))];
  const q: { clubId: number; seed: number; fromGroup: string | null }[] = [];
  for (const g of groups) rows.filter((r) => (r.group ?? "") === g).slice(0, perGroup).forEach((r, i) => q.push({ clubId: r.clubId, seed: i + 1, fromGroup: g || null }));
  await db.delete(stageTeams).where(eq(stageTeams.stageId, next.id));
  if (q.length) await db.insert(stageTeams).values(q.map((x) => ({ stageId: next.id, clubId: x.clubId, seed: x.seed, fromGroup: x.fromGroup })));
  await db.update(competitionStages).set({ status: "DONE", qualifyPerGroup: perGroup }).where(eq(competitionStages.id, stageId));
  await db.update(competitionStages).set({ status: "ACTIVE" }).where(eq(competitionStages.id, next.id));
  return { count: q.length, next };
}

/** المرحلة الحالية التي يُطبق عليها خصم النقاط */
export async function activeTableStage(competitionId: number) {
  const st = (await ensureStages(competitionId)).filter((x) => x.format !== "KNOCKOUT");
  return st.find((x) => x.status !== "DONE") ?? st[st.length - 1] ?? null;
}
