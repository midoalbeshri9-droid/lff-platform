import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { competitions, competitionStages, matches, clubs, matchEvents, players, staff, sanctions, suspensions, seasons, ageCategories, roundDecisions, settings, type DecisionContent, type DecisionRow } from "@/db/schema";
import { koRoundName } from "./competitionPure";
import { STAFF_ROLE } from "./labels";
import { dinarsWords } from "./tafqeet";

const ORD = ["", "الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس", "السابع", "الثامن", "التاسع", "العاشر", "الحادي عشر", "الثاني عشر", "الثالث عشر", "الرابع عشر", "الخامس عشر", "السادس عشر", "السابع عشر", "الثامن عشر", "التاسع عشر", "العشرون"];
const GROUP_ORD: Record<string, string> = { "أ": "الأولى", "ب": "الثانية", "ج": "الثالثة", "د": "الرابعة", "هـ": "الخامسة", "و": "السادسة", "ز": "السابعة", "ح": "الثامنة" };
export const weekName = (n: number) => `الأسبوع ${ORD[n] ?? n}`;
export const groupName = (g: string) => `المجموعة ${GROUP_ORD[g] ?? g}`;

export const DEFAULT_PREAMBLE = [
  "على القانون رقم (23) لسنة 2023م ولائحته التنفيذية.",
  "وعلى النظام الأساسي الموحد للاتحاد الليبي لكرة القدم المعتمد من قبل الجمعية العمومية.",
  "وعلى القانون الدولي للعبة كرة القدم وتعديلاته.",
  "وعلى اللوائح المنظمة للعبة كرة القدم المعمول بها لدى الاتحاد الليبي لكرة القدم والقرارات المتممة لها والتعليمات والتعميمات التنظيمية الصادرة عن مجلس إدارة الاتحاد الليبي لكرة القدم.",
  "وعلى قرار مجلس إدارة الاتحاد الليبي لكرة القدم بشأن تنظيم المسابقة.",
  "وعلى تقارير حكام ومراقبي المباريات.",
  "وعلى ما أقرته لجنة تنظيم المسابقات.",
];

type Ctx = Awaited<ReturnType<typeof context>>;
async function context(stageId: number, round: number) {
  const [st] = await db.select().from(competitionStages).where(eq(competitionStages.id, stageId));
  const [c] = await db.select().from(competitions).where(eq(competitions.id, st.competitionId));
  const [season] = await db.select().from(seasons).where(eq(seasons.id, c.seasonId));
  const [cat] = c.categoryId ? await db.select().from(ageCategories).where(eq(ageCategories.id, c.categoryId)) : [];
  const stages = await db.select().from(competitionStages).where(eq(competitionStages.competitionId, c.id));
  const ms = await db.select().from(matches).where(and(eq(matches.stageId, stageId), eq(matches.round, round))).orderBy(asc(matches.groupName), asc(matches.kickoff), asc(matches.id));
  const name = new Map((await db.select({ id: clubs.id, name: clubs.name }).from(clubs)).map((x) => [x.id, x.name]));
  const ko = st.format === "KNOCKOUT";
  const roundLabel = ko ? (ms.some((m) => m.isThirdPlace) && ms.every((m) => m.isThirdPlace) ? "مباراة المركز الثالث" : koRoundName(new Set(ms.filter((m) => !m.isThirdPlace).map((m) => m.tieNo)).size * 2, round)) : weekName(round);
  const leg = !ko && st.legs === 2 ? (round > (Math.max(0, ...(await db.select({ r: matches.round }).from(matches).where(eq(matches.stageId, stageId))).map((x) => x.r)) / 2) ? "الإياب" : "الذهاب") : "";
  const groups = [...new Set(ms.map((m) => m.groupName ?? ""))];
  const scope = `${roundLabel}${leg ? ` لمرحلة ${leg}` : ""}${stages.length > 1 ? ` (${st.name})` : ""}${groups.length === 1 && groups[0] ? ` ${groupName(groups[0])}` : ""}`;
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
async function generate(x: Ctx): Promise<Omit<DecisionContent, "preamble" | "extra" | "closing" | "signerName" | "signerTitle">> {
  const { c, season, ms, name, scope, cat } = x;
  const ids = ms.map((m) => m.id);
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
  const staff_: DecisionRow[] = evs.filter((r) => isStaff(r)).map((r) => ({
    name: r.s?.fullName ?? r.e.staffName ?? "", cardNo: r.s?.cardNo ?? "", category: cat, club: name.get(r.e.clubId) ?? "",
    role: r.e.staffRole || (r.s ? STAFF_ROLE[r.s.role] : "") || "", reason: `${r.e.type === "YELLOW" ? "" : "طرد — "}${r.e.note ?? ""}`,
  }));
  const susp = ids.length ? await db.select().from(suspensions).where(and(inArray(suspensions.sourceMatchId, ids), eq(suspensions.isLifted, false))) : [];
  const reds: DecisionRow[] = evs.filter((r) => r.e.type !== "YELLOW" && !isStaff(r) && r.p).map((r) => {
    const s = susp.find((y) => y.playerId === r.p!.id && y.sourceMatchId === r.e.matchId);
    return { name: r.p!.fullName, cardNo: r.p!.cardNo ?? "", club: name.get(r.e.clubId) ?? "", opponent: opp(r.e.matchId, r.e.clubId),
      reason: r.e.note || (r.e.type === "RED" ? "طرد مباشر" : "إنذار ثانٍ"), ban: s?.matchesTotal ? `${s.matchesTotal} مباراة` : "" };
  });
  const sn = ids.length ? await db.select().from(sanctions).where(and(inArray(sanctions.matchId, ids), eq(sanctions.targetType, "CLUB"), ne(sanctions.status, "REVOKED"))).orderBy(asc(sanctions.id)) : [];
  const clubSanctions = sn.map((s) => {
    const club = name.get(s.clubId) ?? "";
    const what = s.type === "FINE" && s.fineAmount ? `بغرامة مالية قدرها (${Number(s.fineAmount).toLocaleString("en")} د.ل) ${dinarsWords(Number(s.fineAmount))}`
      : s.type === "POINTS_DEDUCTION" ? `بخصم (${s.points}) نقاط من رصيده`
      : s.type === "CLOSED_DOORS" ? `باللعب دون جمهور لعدد (${s.matchesCount ?? 1}) مباراة`
      : s.type === "WARNING" ? "بالإنذار" : s.type === "FORFEIT" ? "باعتباره خاسرًا للمباراة" : `بـ${s.reason}`;
    const fineToo = s.type !== "FINE" && s.fineAmount ? ` وبغرامة مالية قدرها (${Number(s.fineAmount).toLocaleString("en")} د.ل) ${dinarsWords(Number(s.fineAmount))}` : "";
    return `يعاقب نادي (${club}) ${what}${fineToo}${s.articleText ? `، وذلك طبقًا لنص ${s.articleText.replace(/^المادة/, "المادة")}` : ""}.`;
  });
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
    redsIntro: `تعتمد حالات الطرد الواردة في تقارير الحكام ومراقبي المباريات من (${scope}) على اللاعبين المذكورين أدناه وعددهم (${reds.length}): -`,
    reds,
    clubSanctions,
  };
}

/** تحديث العدد في نص المقدمة بعد إضافة صفوف يدوية */
export const recount = (intro: string, n: number) => intro.replace(/وعددهم \(\d+\)/, `وعددهم (${n})`);

/** مسودة جديدة: المقدمة والتوقيع من آخر قرار للمسابقة أو من الإعدادات */
export async function draftFor(stageId: number, round: number): Promise<DecisionContent> {
  const x = await context(stageId, round);
  const gen = await generate(x);
  const [prev] = await db.select().from(roundDecisions).where(eq(roundDecisions.competitionId, x.c.id)).orderBy(asc(roundDecisions.id)).limit(1000).then((r) => r.slice(-1));
  const set = Object.fromEntries((await db.select().from(settings).where(inArray(settings.key, ["decision_signer_name", "decision_signer_title"]))).map((s) => [s.key, s.value]));
  return {
    ...gen,
    preamble: prev?.content.preamble ?? DEFAULT_PREAMBLE,
    extra: [],
    closing: prev?.content.closing ?? "يعمل بهذا القرار من تاريخ صدوره وعلى الجهات ذات العلاقة تنفيذه كلٌّ فيما يخصه.",
    signerName: prev?.content.signerName ?? set.decision_signer_name ?? "",
    signerTitle: prev?.content.signerTitle ?? set.decision_signer_title ?? "رئيس لجنة تنظيم المسابقات",
  };
}

/** إعادة التوليد من بيانات المنظومة مع الإبقاء على الصفوف اليدوية والمقدمة والمواد الإضافية والتوقيع */
export async function regenerate(stageId: number, round: number, old: DecisionContent): Promise<DecisionContent> {
  const gen = await generate(await context(stageId, round));
  const keep = (rows: DecisionRow[]) => rows.filter((r) => r.manual);
  const players = [...gen.players, ...keep(old.players)], staffRows = [...gen.staff, ...keep(old.staff)], reds = [...gen.reds, ...keep(old.reds)];
  return {
    ...old, ...gen,
    players, staff: staffRows, reds,
    playersIntro: recount(gen.playersIntro, players.length), staffIntro: recount(gen.staffIntro, staffRows.length), redsIntro: recount(gen.redsIntro, reds.length),
  };
}

export async function decisionHeader(stageId: number) {
  const [st] = await db.select().from(competitionStages).where(eq(competitionStages.id, stageId));
  const [c] = await db.select().from(competitions).where(eq(competitions.id, st.competitionId));
  const [season] = await db.select().from(seasons).where(eq(seasons.id, c.seasonId));
  return { c, st, season: season?.name ?? "" };
}
