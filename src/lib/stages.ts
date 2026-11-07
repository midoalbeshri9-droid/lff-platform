import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { competitions, competitionStages, stageTeams, competitionTeams, matches, clubs, stadiums } from "@/db/schema";
import { UserError } from "./util";
import { roundRobin, koPairs, koRoundName, tieWinner, GROUP_LETTERS, pickQualifiers } from "./competitionPure";

export type Stage = typeof competitionStages.$inferSelect;
type CompType = (typeof competitions.$inferSelect)["type"];

export const STAGE_FORMAT: Record<string, string> = { LEAGUE: "دوري", GROUPS: "مجموعات", KNOCKOUT: "خروج المغلوب" };
export const CARRY_POINTS: Record<string, string> = { NONE: "لا ترحيل", FULL: "ترحيل كامل النقاط", HALF: "ترحيل نصف النقاط (يُقرب لأعلى)" };
export const KO_PAIRING: Record<string, string> = { SEEDED: "بالتصنيف (أول المجموعة × ثاني المجاورة)", RANK: "حسب المركز (الأول × الأول نهائي، الثاني × الثاني لتحديد الثالث)", DRAW: "قرعة عشوائية", MANUAL: "يدويًا من اللجنة" };
export const TIE_DECIDER: Record<string, string> = { ET_PENS: "وقت إضافي ثم ركلات ترجيح", PENS: "ركلات ترجيح مباشرة" };
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

/** كل منطقة مجموعة (للدرجات الأدنى المقسمة حسب المناطق) */
export async function groupsByRegion(stageId: number) {
  const s = await getStage(stageId);
  if (s.format !== "GROUPS") throw new UserError("التوزيع لمراحل المجموعات فقط");
  if (await stageHasMatches(stageId)) throw new UserError("المرحلة مجدولة — احذف جدولها أولًا");
  const teams = await db.select({ clubId: stageTeams.clubId, name: clubs.name, region: clubs.region }).from(stageTeams).innerJoin(clubs, eq(clubs.id, stageTeams.clubId)).where(eq(stageTeams.stageId, stageId));
  const missing = teams.filter((t) => !t.region?.trim());
  if (missing.length) throw new UserError(`حدّد منطقة هذه الأندية أولًا (الإدارة ← الأندية): ${missing.map((t) => t.name).join("، ")}`);
  const regions = [...new Set(teams.map((t) => t.region!.trim()))].sort();
  if (regions.length < 2) throw new UserError("كل الفرق في منطقة واحدة — استخدم القرعة أو التوزيع اليدوي");
  if (regions.length > GROUP_LETTERS.length) throw new UserError("عدد المناطق أكبر من الحد الأقصى للمجموعات");
  const small = regions.filter((r) => teams.filter((t) => t.region!.trim() === r).length < 2);
  if (small.length) throw new UserError(`لا يكفي فريق واحد لتكوين مجموعة: ${small.join("، ")}`);
  for (const t of teams) await db.update(stageTeams).set({ groupName: GROUP_LETTERS[regions.indexOf(t.region!.trim())] }).where(and(eq(stageTeams.stageId, stageId), eq(stageTeams.clubId, t.clubId)));
  await db.update(competitionStages).set({ groupsCount: regions.length }).where(eq(competitionStages.id, stageId));
  return regions.map((r, i) => `${GROUP_LETTERS[i]}: ${r}`);
}

export async function setGroups(stageId: number, groups: Map<number, string | null>) {
  if (await stageHasMatches(stageId)) throw new UserError("المرحلة مجدولة — احذف جدولها أولًا");
  for (const [clubId, g] of groups) await db.update(stageTeams).set({ groupName: g }).where(and(eq(stageTeams.stageId, stageId), eq(stageTeams.clubId, clubId)));
}

async function venues() {
  const rows = await db.select({ id: clubs.id, stadium: clubs.stadium, city: clubs.city, main: clubs.mainStadiumId }).from(clubs);
  const st = await db.select().from(stadiums);
  // م26: الملعب الأساسي الذي اختاره النادي من سجل الملاعب، وإلا الاسم المكتوب قديمًا
  return (id: number) => {
    const c = rows.find((x) => x.id === id);
    if (!c) return undefined;
    const reg = st.find((x) => x.id === c.main) ?? st.find((x) => x.name === c.stadium);
    return { stadium: reg?.name ?? c.stadium, city: reg?.city ?? c.city, stadiumId: reg?.id ?? null };
  };
}

type Venue = { stadium: string | null; city: string | null; stadiumId: number | null };
function koMatches(competitionId: number, stageId: number, round: number, pairs: [number, number][], legs: number, venue: (id: number) => Venue | undefined, startTie = 1, neutral?: Venue | null, thirdPlace = false) {
  const rows: (typeof matches.$inferInsert)[] = [];
  pairs.forEach(([a, b], i) => {
    // النهائي (مباراة واحدة) على ملعب محايد إن حددته اللجنة
    const v1 = neutral && legs === 1 ? neutral : venue(a);
    rows.push({ competitionId, stageId, round, tieNo: startTie + i, leg: 1, homeClubId: a, awayClubId: b, venue: v1?.stadium, city: v1?.city, stadiumId: v1?.stadiumId, isThirdPlace: thirdPlace });
    if (legs >= 2) rows.push({ competitionId, stageId, round, tieNo: startTie + i, leg: 2, homeClubId: b, awayClubId: a, venue: venue(b)?.stadium, city: venue(b)?.city, stadiumId: venue(b)?.stadiumId });
  });
  return rows;
}

async function neutralVenue(s: Stage): Promise<Venue | null> {
  const name = s.finalVenue?.trim();
  if (!name) return null;
  const [x] = await db.select().from(stadiums).where(eq(stadiums.name, name));
  return { stadium: x?.name ?? name, city: x?.city ?? null, stadiumId: x?.id ?? null };
}

/** فرق خروج المغلوب حسب طريقة الإقران: بالتصنيف أو القرعة */
function pairsFor(s: Stage, teams: { clubId: number; seed: number | null; fromGroup: string | null }[]) {
  if (s.koPairing === "MANUAL") throw new UserError("طريقة الإقران «يدويًا»: حدّد المواجهات من نموذج «المواجهات يدويًا» في تبويب المراحل");
  return koPairs(s.koPairing === "DRAW" ? teams.map((t) => ({ ...t, seed: null })) : teams);
}

/** إقران يدوي للدور الأول في خروج المغلوب (لجنة المسابقات) */
export async function manualKoPairs(stageId: number, pairs: [number, number][]) {
  const s = await getStage(stageId);
  if (s.format !== "KNOCKOUT") throw new UserError("الإقران اليدوي لمراحل خروج المغلوب فقط");
  if (await stageHasMatches(stageId)) throw new UserError("المرحلة مجدولة — احذف جدولها أولًا");
  const teams = new Set((await db.select().from(stageTeams).where(eq(stageTeams.stageId, stageId))).map((t) => t.clubId));
  const used = new Set<number>();
  for (const [a, b] of pairs) {
    if (a === b) throw new UserError("لا يلاقي الفريق نفسه");
    for (const x of [a, b]) {
      if (!teams.has(x)) throw new UserError("فريق ليس من فرق المرحلة");
      if (used.has(x)) throw new UserError("فريق مكرر في أكثر من مواجهة");
      used.add(x);
    }
  }
  if (!pairs.length) throw new UserError("حدّد مواجهة واحدة على الأقل");
  if (used.size !== teams.size) throw new UserError(`لم تُقرن كل الفرق (${used.size} من ${teams.size})`);
  const legs = pairs.length === 1 ? s.finalLegs : s.legs;
  const rows = koMatches(s.competitionId, stageId, 1, pairs, legs, await venues(), 1, pairs.length === 1 ? await neutralVenue(s) : null);
  await db.insert(matches).values(rows);
  await db.update(competitionStages).set({ status: "ACTIVE" }).where(eq(competitionStages.id, stageId));
  return rows.length;
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
      roundRobin(ids, s.legs).forEach((m) => rows.push({ competitionId: s.competitionId, stageId, round: m.round, groupName: g, homeClubId: m.home, awayClubId: m.away, venue: venue(m.home)?.stadium, city: venue(m.home)?.city, stadiumId: venue(m.home)?.stadiumId }));
    }
  } else if (s.format === "KNOCKOUT") {
    if (teams.length % 2) throw new UserError(`عدد الفرق فردي (${teams.length}) — أضف أو احذف فريقًا، أو أضف المباريات يدويًا`);
    if (s.koPairing === "RANK") {
      // مجموعتان: الأول × الأول (النهائي) والثاني × الثاني (المركز الثالث)
      const groups = [...new Set(teams.map((t) => t.fromGroup ?? ""))];
      const by = (g: string, seed: number) => teams.find((t) => (t.fromGroup ?? "") === g && t.seed === seed)?.clubId;
      if (groups.length !== 2 || teams.length > 4 || !by(groups[0], 1) || !by(groups[1], 1)) throw new UserError("«حسب المركز» يتطلب فريقين أو أربعة متأهلين من مجموعتين (الأول والثاني)");
      const neutral = await neutralVenue(s);
      rows.push(...koMatches(s.competitionId, stageId, 1, [[by(groups[0], 1)!, by(groups[1], 1)!]], s.finalLegs, venue, 1, neutral));
      if (teams.length === 4) rows.push(...koMatches(s.competitionId, stageId, 1, [[by(groups[0], 2)!, by(groups[1], 2)!]], 1, venue, 2, neutral, true));
    } else {
      const legs = teams.length === 2 ? s.finalLegs : s.legs;
      rows.push(...koMatches(s.competitionId, stageId, 1, pairsFor(s, teams), legs, venue, 1, teams.length === 2 ? await neutralVenue(s) : null));
    }
  } else {
    roundRobin(teams.map((t) => t.clubId), s.legs).forEach((m) => rows.push({ competitionId: s.competitionId, stageId, round: m.round, homeClubId: m.home, awayClubId: m.away, venue: venue(m.home)?.stadium, city: venue(m.home)?.city, stadiumId: venue(m.home)?.stadiumId }));
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
  const ms = await db.select().from(matches).where(and(eq(matches.stageId, stageId), eq(matches.isThirdPlace, false))).orderBy(asc(matches.round), asc(matches.tieNo), asc(matches.leg), asc(matches.id));
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

/** مباراة تحديد المركز الثالث (إن وُجدت) */
export async function thirdPlaceTie(stageId: number): Promise<Tie | null> {
  const legs = await db.select().from(matches).where(and(eq(matches.stageId, stageId), eq(matches.isThirdPlace, true))).orderBy(asc(matches.leg), asc(matches.id));
  if (!legs.length) return null;
  return { tieNo: legs[0].tieNo ?? 0, legs, a: legs[0].homeClubId, b: legs[0].awayClubId, winner: tieWinner(legs) };
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
    const third = await thirdPlaceTie(stageId);
    if (third && third.winner == null) throw new UserError("مباراة المركز الثالث لم تُحسم بعد");
    await db.update(competitionStages).set({ status: "DONE" }).where(eq(competitionStages.id, stageId));
    return { champion: winners[0], created: 0 };
  }
  if (winners.length % 2) throw new UserError("عدد الفائزين فردي — أضف مباريات الدور التالي يدويًا");
  const pairs: [number, number][] = [];
  for (let i = 0; i < winners.length; i += 2) pairs.push([winners[i], winners[i + 1]]);
  const legs = pairs.length === 1 ? s.finalLegs : s.legs;
  const venue = await venues();
  const neutral = pairs.length === 1 ? await neutralVenue(s) : null;
  const rows = koMatches(s.competitionId, stageId, last.round + 1, pairs, legs, venue, 1, neutral);
  // مباراة المركز الثالث بين الخاسرَين في نصف النهائي (مباراة واحدة)
  if (pairs.length === 1 && s.thirdPlace && last.ties.length === 2) {
    const losers = last.ties.map((t) => (t.winner === t.a ? t.b : t.a)) as [number, number];
    rows.push(...koMatches(s.competitionId, stageId, last.round + 1, [losers], 1, venue, 2, neutral, true));
  }
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
type QRow = { clubId: number; group: string | null; pts: number; p: number; gd: number; gf: number };
export async function qualifyToNext(stageId: number, perGroup: number, best: number, standingsFn: (competitionId: number, stageId: number) => Promise<QRow[]>) {
  const s = await getStage(stageId);
  if (s.format === "KNOCKOUT") throw new UserError("في خروج المغلوب استخدم «إنشاء الدور التالي»");
  const [next] = await db.select().from(competitionStages).where(and(eq(competitionStages.competitionId, s.competitionId), eq(competitionStages.seq, s.seq + 1)));
  if (!next) throw new UserError("لا توجد مرحلة تالية — أضفها أولًا من «إضافة مرحلة»");
  if (await stageHasMatches(next.id)) throw new UserError("المرحلة التالية مجدولة مسبقًا — احذف جدولها لإعادة التأهيل");
  const pending = await db.select({ id: matches.id }).from(matches).where(and(eq(matches.stageId, stageId), inArray(matches.status, ["SCHEDULED", "POSTPONED"]))).limit(1);
  if (pending.length) throw new UserError("توجد مباريات لم تُلعب أو لم تُعتمد في هذه المرحلة");
  if (!(perGroup >= 1)) throw new UserError("حدد عدد المتأهلين");
  const rows = await standingsFn(s.competitionId, stageId);
  const q = pickQualifiers(rows, perGroup, best);
  const carry = (pts: number) => (next.carryPoints === "FULL" ? pts : next.carryPoints === "HALF" ? Math.ceil(pts / 2) : 0);
  await db.delete(stageTeams).where(eq(stageTeams.stageId, next.id));
  if (q.length) await db.insert(stageTeams).values(q.map((x) => ({ stageId: next.id, clubId: x.clubId, seed: x.seed, fromGroup: x.fromGroup, bonusPts: carry(x.pts) })));
  await db.update(competitionStages).set({ status: "DONE", qualifyPerGroup: perGroup, qualifyBest: best || null }).where(eq(competitionStages.id, stageId));
  await db.update(competitionStages).set({ status: "ACTIVE" }).where(eq(competitionStages.id, next.id));
  return { count: q.length, next };
}

/** المرحلة الحالية التي يُطبق عليها خصم النقاط */
export async function activeTableStage(competitionId: number) {
  const st = (await ensureStages(competitionId)).filter((x) => x.format !== "KNOCKOUT");
  return st.find((x) => x.status !== "DONE") ?? st[st.length - 1] ?? null;
}
