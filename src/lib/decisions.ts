import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { stageTeams, competitions, competitionStages, matches, matchSquads, clubs, matchEvents, players, staff, sanctions, suspensions, seasons, ageCategories, roundDecisions, settings, type DecisionContent, type DecisionRow } from "@/db/schema";
import { koRoundName } from "./competitionPure";
import { STAFF_ROLE } from "./labels";
import { dinarsWords } from "./tafqeet";

const ORD = ["", "الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع", "العاشر", "الحادي عشر", "الثاني عشر", "الثالث عشر", "الرابع عشر", "الخامس عشر", "السادس عشر", "السابع عشر", "الثامن عشر", "التاسع عشر", "العشرون"];
const GROUP_ORD: Record<string, string> = { "أ": "الأولى", "ب": "الثانية", "ج": "الثالثة", "د": "الرابعة", "هـ": "الخامسة", "و": "السادسة", "ز": "السابعة", "ح": "الثامنة" };
/** «(1) مباراة واحدة» / «(2) مباراتين» / «(3) ثلاث مباريات» */
export function matchesWords(n: number) {
  const W = ["", "مباراة واحدة", "مباراتين", "ثلاث مباريات", "أربع مباريات", "خمس مباريات", "ست مباريات", "سبع مباريات", "ثماني مباريات", "تسع مباريات", "عشر مباريات"];
  return `(${n}) ${W[n] ?? "مباراة"}`;
}
const money = (v: string | number) => `(${Number(v)} د.ل) ${dinarsWords(Number(v))}`;
const FAN_RX = /جمهور|جماهير|مشجع|المدرجات|الألعاب النارية|الشماريخ/;
export const weekName = (n: number) => `الأسبوع ${ORD[n] ?? n}`;
export const groupName = (g: string) => `المجموعة ${GROUP_ORD[g] ?? g}`;

export const DEFAULT_PREAMBLE = [
  "على القانون رقم (23) لسنة 2023م ولائحته التنفيذية.",
  "وعلى النظام الأساسي الموحد للاتحاد الليبي لكرة القدم المعتمد من قبل الجمعية العمومية بتاريخ 2024/10/14م.",
  "وعلى النتائج النهائية لانتخاب مجلس إدارة الاتحاد في الجلسة الانتخابية غير العادية للجمعية العمومية للاتحاد الليبي لكرة القدم المنعقدة بتاريخ يوم السبت الموافق 2025/01/04م.",
  "وعلى القانون الدولي للعبة كرة القدم وتعديلاته.",
  "وعلى اللوائح المنظمة للعبة كرة القدم المعمول بها لدى الاتحاد الليبي لكرة القدم والقرارات المتممة لها والتعليمات والتعميمات التنظيمية الصادرة عن مجلس إدارة الاتحاد الليبي لكرة القدم.",
  "وعلى قرار مجلس إدارة الاتحاد الليبي لكرة القدم رقم (116) لسنة 2026 بشأن قرار تنظيم مسابقة الدوري الليبي الممتاز للموسم الرياضي 2027/2026م.",
  "وعلى قرار مجلس إدارة الاتحاد الليبي لكرة القدم رقم (122) لسنة 2026م بشأن إعادة تشكيل لجنة تنظيم المسابقات للموسم الرياضي 2027/2026م.",
  "وعلى قرار مجلس إدارة الاتحاد الليبي لكرة القدم رقم (131) لسنة 2026 بشأن تعديل فقرتين في قرار مجلس إدارة الاتحاد الليبي لكرة القدم رقم (116) لسنة 2026م الصادر بشأن قرار تنظيم مسابقة الدوري الليبي الممتاز للموسم الرياضي 2027/2026م.",
  "وعلى تقارير حكام ومراقبي المباريات.",
  "وعلى ما أقرته لجنة تنظيم المسابقات.",
];

type Ctx = Awaited<ReturnType<typeof context>>;
export type Scope = { stageId: number; round: number; group?: string | null; matchIds?: number[] | null; postponed?: boolean };
async function context({ stageId, round, group, matchIds, postponed }: Scope) {
  const [st] = await db.select().from(competitionStages).where(eq(competitionStages.id, stageId));
  const [c] = await db.select().from(competitions).where(eq(competitions.id, st.competitionId));
  const [season] = await db.select().from(seasons).where(eq(seasons.id, c.seasonId));
  const [cat] = c.categoryId ? await db.select().from(ageCategories).where(eq(ageCategories.id, c.categoryId)) : [];
  const stages = await db.select().from(competitionStages).where(eq(competitionStages.competitionId, c.id));
  const ms = await db.select().from(matches).where(and(eq(matches.stageId, stageId), eq(matches.round, round), group ? eq(matches.groupName, group) : undefined, matchIds?.length ? inArray(matches.id, matchIds) : undefined))
    .orderBy(asc(matches.groupName), asc(matches.kickoff), asc(matches.id));
  const name = new Map((await db.select({ id: clubs.id, name: clubs.name }).from(clubs)).map((x) => [x.id, x.name]));
  const ko = st.format === "KNOCKOUT";
  const roundLabel = ko ? (ms.some((m) => m.isThirdPlace) && ms.every((m) => m.isThirdPlace) ? "مباراة المركز الثالث" : koRoundName(new Set(ms.filter((m) => !m.isThirdPlace).map((m) => m.tieNo)).size * 2, round)) : weekName(round);
  // الذهاب/الإياب: عدد جولات الدور = عدد فرق المجموعة − 1 (أو العدد نفسه إن كان فرديًا)
  let leg = "";
  if (!ko && st.legs === 2) {
    const n = (await db.select({ id: stageTeams.id }).from(stageTeams).where(and(eq(stageTeams.stageId, stageId), group ? eq(stageTeams.groupName, group) : undefined))).length;
    const perLeg = n % 2 ? n : n - 1;
    leg = perLeg > 0 && round > perLeg ? "الإياب" : "الذهاب";
  }
  const groups = [...new Set(ms.map((m) => m.groupName ?? ""))];
  const scope = `${postponed ? "المؤجلة من " : ""}${roundLabel}${leg ? ` لمرحلة ${leg}` : ""}${stages.length > 1 ? ` (${st.name})` : ""}${groups.length === 1 && groups[0] ? ` ${groupName(groups[0])}` : ""}`;
  return { st, c, season, cat: cat?.name ?? "أكابر", ms, name, scope };
}

const resultText = (m: typeof matches.$inferSelect, name: Map<number, string>) => {
  if (m.status === "POSTPONED") return "مؤجلة";
  if (m.status === "CANCELLED") return "ملغاة";
  if (m.homeScore == null || m.awayScore == null) return "لم تُلعب";
  const win = m.homeScore > m.awayScore ? m.homeClubId : m.awayScore > m.homeScore ? m.awayClubId
    : m.homePens != null && m.awayPens != null && m.homePens !== m.awayPens ? (m.homePens > m.awayPens ? m.homeClubId : m.awayClubId) : null;
  const pens = m.homePens != null ? ` بركلات الترجيح (${m.awayPens} - ${m.homePens})` : "";
  if (m.status === "FORFEIT") return `فوز اعتباري لفريق ${name.get(win!) ?? ""}`;
  return win ? `لصالح فريق ${name.get(win)}${pens}` : "التعادل بين الفريقين";
};

/** المحتوى المولَّد من بيانات المنظومة للجولة */
async function generate(x: Ctx): Promise<Omit<DecisionContent, "preamble" | "extra" | "closing" | "signerName" | "signerTitle" | "banArticle">> {
  const { c, season, ms, name, scope, cat } = x;
  const ids = ms.map((m) => m.id);
  // نادي اللاعب في هذه المباريات (من القوائم أو من أحداثه)
  const clubOfPlayer = new Map<number, string>();
  if (ids.length) {
    for (const q of await db.select({ p: matchSquads.playerId, c: matchSquads.clubId }).from(matchSquads).where(inArray(matchSquads.matchId, ids))) clubOfPlayer.set(q.p, name.get(q.c) ?? "");
    for (const q of await db.select({ p: matchEvents.playerId, c: matchEvents.clubId }).from(matchEvents).where(inArray(matchEvents.matchId, ids))) if (q.p) clubOfPlayer.set(q.p, name.get(q.c) ?? "");
  }
  const opp = (mid: number, club: number) => { const m = ms.find((y) => y.id === mid)!; return name.get(m.homeClubId === club ? m.awayClubId : m.homeClubId) ?? ""; };
  const groups = [...new Set(ms.map((m) => m.groupName ?? ""))];
  const results = groups.map((g) => ({
    group: g ? groupName(g) : "",
    rows: ms.filter((m) => (m.groupName ?? "") === g).map((m) => ({
      teams: `${name.get(m.homeClubId)} × ${name.get(m.awayClubId)}`,
      score: m.homeScore == null ? "—" : `${m.awayScore} - ${m.homeScore}`,
      result: resultText(m, name),
    })),
  }));
  const evs = ids.length ? await db.select({ e: matchEvents, p: players, s: staff }).from(matchEvents)
    .leftJoin(players, eq(players.id, matchEvents.playerId)).leftJoin(staff, eq(staff.id, matchEvents.staffId))
    .where(and(inArray(matchEvents.matchId, ids), inArray(matchEvents.type, ["YELLOW", "SECOND_YELLOW", "RED"]))).orderBy(asc(matchEvents.matchId), asc(matchEvents.clubId), asc(matchEvents.minute)) : [];
  const isStaff = (r: (typeof evs)[number]) => !!(r.e.staffId || r.e.staffName);
  const players_: DecisionRow[] = evs.filter((r) => r.e.type === "YELLOW" && !isStaff(r) && r.p).map((r) => ({
    name: r.p!.fullName, cardNo: r.p!.cardNo ?? "", category: cat, club: name.get(r.e.clubId) ?? "", opponent: opp(r.e.matchId, r.e.clubId), reason: r.e.note ?? "",
  }));
  const staff_: DecisionRow[] = evs.filter((r) => isStaff(r) && r.e.type === "YELLOW").map((r) => ({
    name: r.s?.fullName ?? r.e.staffName ?? "", cardNo: r.s?.cardNo ?? "", category: cat, club: name.get(r.e.clubId) ?? "",
    role: r.e.staffRole || (r.s ? STAFF_ROLE[r.s.role] : "") || "", reason: r.e.note ?? "",
  }));
  // العقوبات: الإيقافات التلقائية (طرد / تراكم إنذارات) وقرارات العقوبات المرتبطة بمباريات الجولة
  const kibar = cat === "أكابر" ? "كبار" : cat;
  const susp = ids.length ? await db.select({ s: suspensions, p: players }).from(suspensions).innerJoin(players, eq(players.id, suspensions.playerId))
    .where(and(inArray(suspensions.sourceMatchId, ids), eq(suspensions.isLifted, false), eq(suspensions.kind, "MATCHES"))).orderBy(asc(suspensions.id)) : [];
  const sn = ids.length ? await db.select({ s: sanctions, p: players, st: staff }).from(sanctions).leftJoin(players, eq(players.id, sanctions.playerId)).leftJoin(staff, eq(staff.id, sanctions.staffId))
    .where(and(inArray(sanctions.matchId, ids), ne(sanctions.status, "REVOKED"))).orderBy(asc(sanctions.id)) : [];
  const art = (t: string | null) => `، وذلك طبقًا لنص ${t?.trim() || "%ART%"}.`;
  const penalty = (s: typeof sanctions.$inferSelect, ban: string) => {
    const parts: string[] = [];
    if (s.type === "MATCH_BAN" || (s.matchesCount && ["MATCH_BAN"].includes(s.type))) parts.push(`${ban} لعدد ${matchesWords(s.matchesCount ?? 1)}`);
    else if (s.type === "TIME_BAN") parts.push(`${ban} لمدة من ${s.fromDate ?? "..."} إلى ${s.toDate ?? "..."}`);
    else if (s.type === "WARNING") parts.push("بالإنذار");
    else if (s.type === "POINTS_DEDUCTION") parts.push(`بخصم (${s.points}) نقاط من رصيده`);
    else if (s.type === "CLOSED_DOORS") parts.push(`باللعب دون جمهور لعدد ${matchesWords(s.matchesCount ?? 1)}`);
    else if (s.type === "STADIUM_BAN") parts.push(`بالحرمان من ملعبه لعدد ${matchesWords(s.matchesCount ?? 1)}`);
    else if (s.type === "FORFEIT") parts.push("باعتباره خاسرًا للمباراة");
    if (s.fineAmount && Number(s.fineAmount) > 0) parts.push(`${parts.length ? "وب" : "ب"}غرامة مالية قدرها ${money(s.fineAmount)}`);
    if (!parts.length) parts.push(`بـ${s.reason}`);
    return parts.join(" ");
  };
  const playerSanctions = [
    ...susp.filter((x) => !sn.some((y) => y.s.suspensionId === x.s.id)).map(({ s, p }) =>
      `يعاقب اللاعب (${p.fullName})${p.cardNo ? ` رقم البطاقة الرياضية (${p.cardNo})` : ""} من ${kibar} فريق (${clubOfPlayer.get(p.id) ?? ""}) بالإيقاف عن المشاركة مع فريقه لعدد ${matchesWords(s.matchesTotal ?? 1)}${art(null)}`),
    ...sn.filter((x) => x.s.targetType === "PLAYER" && x.p).map(({ s, p }) =>
      `يعاقب اللاعب (${p!.fullName})${p!.cardNo ? ` رقم البطاقة الرياضية (${p!.cardNo})` : ""} من ${kibar} فريق (${name.get(s.clubId) ?? ""}) ${penalty(s, "بالإيقاف عن المشاركة مع فريقه")}${art(s.articleText)}`),
  ];
  const staffSanctions = [
    ...evs.filter((r) => isStaff(r) && r.e.type !== "YELLOW" && !sn.some((y) => y.s.targetType === "STAFF" && y.s.staffId && y.s.staffId === r.e.staffId)).map((r) =>
      `يعاقب (${r.e.staffRole || (r.s ? STAFF_ROLE[r.s.role] : "")}) فريق (${name.get(r.e.clubId) ?? ""}) (${r.s?.fullName ?? r.e.staffName ?? ""}) بالإيقاف عن مرافقة فريقه لعدد ${matchesWords(1)}${art(null)}`),
    ...sn.filter((x) => x.s.targetType === "STAFF").map(({ s, st }) =>
      `يعاقب (${st ? STAFF_ROLE[st.role] : ""}) فريق (${name.get(s.clubId) ?? ""}) (${st?.fullName ?? ""}) ${penalty(s, "بالإيقاف عن مرافقة فريقه")}${art(s.articleText)}`),
  ];
  const clubRows = sn.filter((x) => x.s.targetType === "CLUB");
  const isFan = (s: typeof sanctions.$inferSelect) => s.type === "CLOSED_DOORS" || s.type === "STADIUM_BAN" || FAN_RX.test(`${s.reason} ${s.articleText ?? ""} ${s.notes ?? ""}`);
  const clubText = ({ s }: (typeof sn)[number]) => `يعاقب نادي (${name.get(s.clubId) ?? ""}) ${penalty(s, "")}${art(s.articleText)}`;
  const clubSanctions = clubRows.filter((x) => !isFan(x.s)).map(clubText);
  const fanSanctions = clubRows.filter((x) => isFan(x.s)).map(clubText);
  const sYear = season?.name ?? "";
  const comp = c.name;
  return {
    subject: `بشأن اعتماد نتائج مباريات (${scope}) ضمن مسابقة ${comp} للموسم الرياضي ${sYear}م`,
    resultsIntro: `تعتمد نتائج مباريات (${scope}) ضمن مسابقة ${comp} كما انتهت عليه وعلى النحو التالي: -`,
    results,
    playersIntro: `تعتمد بطاقات الإنذار للرياضيين الواردة في تقارير الحكام ومراقبي المباريات من (${scope}) ضمن مسابقة ${comp} للموسم الرياضي ${sYear}م على اللاعبين المذكورين أدناه وعددهم (${players_.length}): -`,
    players: players_,
    staffIntro: `تعتمد بطاقات الإنذار للمرافقين الواردة في تقارير الحكام والمراقبين لمباريات (${scope}) ضمن مسابقة ${comp} للموسم الرياضي ${sYear}م على المرافقين المذكورين أدناه وعددهم (${staff_.length}): -`,
    staff: staff_,
    playerSanctions, staffSanctions, clubSanctions, fanSanctions,
  };
}

/** نص المادة الافتراضي للإيقافات التلقائية */
function withArticle<T extends { playerSanctions: string[]; staffSanctions: string[] }>(g: T, art: string): T {
  const f = (a: string[]) => a.map((x) => x.replace("%ART%", art || "المادة (  ) من لائحة الجزاءات"));
  return { ...g, playerSanctions: f(g.playerSanctions), staffSanctions: f(g.staffSanctions) };
}

/** تحديث العدد في نص المقدمة بعد إضافة صفوف يدوية */
export const recount = (intro: string, n: number) => intro.replace(/وعددهم \(\d+\)/, `وعددهم (${n})`);

/** مسودة جديدة: المقدمة والتوقيع من آخر قرار للمسابقة أو من الإعدادات */
export async function draftFor(sc: Scope): Promise<DecisionContent> {
  const x = await context(sc);
  const gen = await generate(x);
  const [prev] = await db.select().from(roundDecisions).where(eq(roundDecisions.competitionId, x.c.id)).orderBy(asc(roundDecisions.id)).limit(1000).then((r) => r.slice(-1));
  const set = Object.fromEntries((await db.select().from(settings).where(inArray(settings.key, ["decision_signer_name", "decision_signer_title"]))).map((s) => [s.key, s.value]));
  const banArticle = prev?.content.banArticle ?? "المادة (  ) من لائحة الجزاءات";
  return {
    ...withArticle(gen, banArticle),
    banArticle,
    preamble: prev?.content.preamble ?? DEFAULT_PREAMBLE,
    extra: [],
    closing: prev?.content.closing ?? "يعمل بهذا القرار من تاريخ صدوره وعلى الجهات ذات العلاقة تنفيذه كلٌّ فيما يخصه.",
    signerName: prev?.content.signerName ?? set.decision_signer_name ?? "",
    signerTitle: prev?.content.signerTitle ?? set.decision_signer_title ?? "رئيس لجنة تنظيم المسابقات",
  };
}

/** إعادة التوليد من بيانات المنظومة مع الإبقاء على الصفوف اليدوية والمقدمة والمواد الإضافية والتوقيع */
export async function regenerate(sc: Scope, old: DecisionContent): Promise<DecisionContent> {
  const gen = withArticle(await generate(await context(sc)), old.banArticle);
  const keep = (rows: DecisionRow[]) => rows.filter((r) => r.manual);
  const players = [...gen.players, ...keep(old.players)], staffRows = [...gen.staff, ...keep(old.staff)];
  return {
    ...old, ...gen,
    players, staff: staffRows,
    playersIntro: recount(gen.playersIntro, players.length), staffIntro: recount(gen.staffIntro, staffRows.length),
  };
}

export async function decisionHeader(stageId: number) {
  const [st] = await db.select().from(competitionStages).where(eq(competitionStages.id, stageId));
  const [c] = await db.select().from(competitions).where(eq(competitions.id, st.competitionId));
  const [season] = await db.select().from(seasons).where(eq(seasons.id, c.seasonId));
  return { c, st, season: season?.name ?? "" };
}

/** أندية القرار: فرق مباريات القرار (أو مباريات الجولة إن لم تُحدد) */
export async function decisionClubs(d: { stageId: number; round: number; matchIds: number[] | null }) {
  const ms = d.matchIds?.length
    ? await db.select({ h: matches.homeClubId, a: matches.awayClubId }).from(matches).where(inArray(matches.id, d.matchIds))
    : await db.select({ h: matches.homeClubId, a: matches.awayClubId }).from(matches).where(and(eq(matches.stageId, d.stageId), eq(matches.round, d.round)));
  const ids = [...new Set(ms.flatMap((m) => [m.h, m.a]))];
  return ids.length ? db.select({ id: clubs.id, name: clubs.name, phone: clubs.phone }).from(clubs).where(inArray(clubs.id, ids)).orderBy(clubs.name) : [];
}
