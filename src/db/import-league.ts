// إعداد مسابقة الدوري الممتاز من اللائحة والجداول: المسابقة والمراحل والمجموعات والقوائم والملاعب والمباريات ومراقبو المباريات وتعيينهم
// الفحص (لا يغيّر شيئًا): npx tsx src/db/import-league.ts check data/import/league-2026.json data/import/observers-2026.json data/league-report.txt
// التنفيذ:                 npx tsx src/db/import-league.ts apply data/import/league-2026.json data/import/observers-2026.json data/league-report.txt
// آمن للتكرار: لا يكرر مسابقة أو مباراة أو مراقبًا أو تعيينًا موجودًا
import "dotenv/config";
import { readFileSync, writeFileSync } from "fs";
import { and, eq, inArray, isNull } from "drizzle-orm";
import * as s from "./schema";
import { db } from "./index";

type Mx = { date: string; time: string; home: string; away: string; venue: string; observer: string | null; note: string };
type League = { competition: string; season: string; division: string; groups: Record<string, string[]>; rounds: Record<string, Record<string, Mx[]>> };
type Obs = { name: string; branch: string; grade: string };
const BY = "إعداد الدوري الممتاز";
const nc = (x: string) => x.replace(/^\s*(نادي|فريق)\s+/, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, "").toLowerCase();
/** كلمات الاسم بعد التوحيد (عبد الX → عبدالX، ابو X → ابوX، بلا «ال» التعريف في أول الكلمة) */
const words = (x: string) => x.replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/عبد\s+/g, "عبد").replace(/ابو\s+/g, "ابو").replace(/يحيي/g, "يحي")
  .split(/\s+/).filter(Boolean).map((w) => w.replace(/^ال(?=..)/, "").replace(/^ا(?=س)/, ""));
function lev1(a: string, b: string) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 4) return false;
  let i = 0, j = 0, diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return diff + (a.length - i) + (b.length - j) <= 1;
}
/** اسم مختصر في الجدول (الاسم الأول + اللقب) ← الاسم الكامل في كشف المراقبين */
function findObserver(short: string, list: { id: number | null; name: string }[]) {
  const sw = words(short);
  const hits = list.filter((o) => { const ow = words(o.name); return ow[0] && lev1(ow[0], sw[0]) && sw.slice(1).every((w) => ow.slice(1).some((x) => lev1(x, w))); });
  return hits.length === 1 ? hits[0] : hits.length > 1 ? "AMBIG" : null;
}
const kickoff = (m: Mx) => new Date(`${m.date}T${m.time}:00+02:00`);

async function run(apply: boolean, leagueFile: string, obsFile: string, reportFile: string) {
  const L = JSON.parse(readFileSync(leagueFile, "utf8")) as League;
  const O = JSON.parse(readFileSync(obsFile, "utf8")) as Obs[];
  const out: string[] = [], warn: string[] = [];
  let [se] = await db.select().from(s.seasons).where(eq(s.seasons.name, L.season));
  if (!se) [se] = await db.select().from(s.seasons).where(eq(s.seasons.isCurrent, true));
  const [div] = await db.select().from(s.divisions).where(eq(s.divisions.name, L.division));
  const clubs = await db.select({ id: s.clubs.id, name: s.clubs.name }).from(s.clubs);
  const club = (n: string) => clubs.find((c) => nc(c.name) === nc(n));
  const missing = Object.values(L.groups).flat().filter((n) => !club(n));
  if (missing.length) throw new Error("أندية غير موجودة في المنظومة: " + missing.join("، "));
  const [cat] = await db.select().from(s.ageCategories).where(isNull(s.ageCategories.maxAge)).limit(1);

  // ===== المسابقة والمراحل =====
  let [c] = await db.select().from(s.competitions).where(and(eq(s.competitions.name, L.competition), eq(s.competitions.seasonId, se.id)));
  out.push(c ? `■ المسابقة موجودة: ${c.name}` : `■ تُنشأ المسابقة: ${L.competition} (${se.name})`);
  let stage1: typeof s.competitionStages.$inferSelect | undefined, stage2: typeof s.competitionStages.$inferSelect | undefined;
  if (apply && !c) {
    [c] = await db.insert(s.competitions).values({
      name: L.competition, seasonId: se.id, divisionId: div?.id ?? null, categoryId: cat?.id ?? null, type: "GROUPS_KNOCKOUT", legs: 2, pointsWin: 3, pointsDraw: 1,
      status: "ACTIVE", startDate: "2026-10-13", notes: "قرار مجلس إدارة الاتحاد رقم (116) لسنة 2026م بشأن شكل وآلية نظام المسابقة",
    }).returning();
    [stage1] = await db.insert(s.competitionStages).values({ competitionId: c.id, seq: 1, name: "المرحلة الأولى", format: "GROUPS", legs: 2, qualifyPerGroup: 2, status: "ACTIVE",
      notes: "مجموعتان ذهابًا وإيابًا — يتأهل الأول والثاني من كل مجموعة، ويهبط أصحاب المراكز 12 و13 و14" }).returning();
    [stage2] = await db.insert(s.competitionStages).values({ competitionId: c.id, seq: 2, name: "المرحلة النهائية", format: "KNOCKOUT", legs: 1, finalLegs: 1,
      koPairing: "RANK", tieDecider: "ET_PENS", resetYellows: true,
      notes: "الأول × الأول لتحديد البطل، والثاني × الثاني لتحديد الثالث والرابع — على ملعب محايد يحدده مجلس الإدارة" }).returning();
  } else if (c) {
    const st = await db.select().from(s.competitionStages).where(eq(s.competitionStages.competitionId, c.id)).orderBy(s.competitionStages.seq);
    stage1 = st.find((x) => x.format === "GROUPS") ?? st[0]; stage2 = st.find((x) => x.format === "KNOCKOUT");
  }
  out.push(`  المرحلة الأولى: مجموعتان ذهابًا وإيابًا (يتأهل 2 من كل مجموعة) — المرحلة النهائية: حسب المركز، مباراة واحدة، وقت إضافي ثم ترجيح، تصفير الإنذارات`);

  // ===== الفرق والمجموعات والقوائم =====
  for (const [g, names] of Object.entries(L.groups)) {
    out.push(`■ المجموعة ${g === "أ" ? "الأولى" : "الثانية"} (${names.length}): ${names.join("، ")}`);
    if (!apply || !c || !stage1) continue;
    for (const n of names) {
      const cl = club(n)!;
      const [ct] = await db.select().from(s.competitionTeams).where(and(eq(s.competitionTeams.competitionId, c.id), eq(s.competitionTeams.clubId, cl.id)));
      if (!ct) await db.insert(s.competitionTeams).values({ competitionId: c.id, clubId: cl.id, groupName: g });
      const [stt] = await db.select().from(s.stageTeams).where(and(eq(s.stageTeams.stageId, stage1.id), eq(s.stageTeams.clubId, cl.id)));
      if (!stt) await db.insert(s.stageTeams).values({ stageId: stage1.id, clubId: cl.id, groupName: g });
    }
  }
  const allIds = Object.values(L.groups).flat().map((n) => club(n)!.id);
  const regs = await db.select({ p: s.registrations.playerId, c: s.registrations.clubId }).from(s.registrations)
    .where(and(eq(s.registrations.seasonId, se.id), eq(s.registrations.status, "APPROVED"), inArray(s.registrations.clubId, allIds)));
  out.push(`■ قوائم المسابقة: ${regs.length} لاعبًا من قيود الموسم المعتمدة`);
  if (apply && c) {
    const have = new Set((await db.select({ p: s.competitionSquads.playerId }).from(s.competitionSquads).where(eq(s.competitionSquads.competitionId, c.id))).map((x) => x.p));
    const rows = regs.filter((r) => !have.has(r.p)).map((r) => ({ competitionId: c!.id, clubId: r.c, playerId: r.p }));
    for (let i = 0; i < rows.length; i += 200) await db.insert(s.competitionSquads).values(rows.slice(i, i + 200)).onConflictDoNothing();
  }

  // ===== المراقبون =====
  const existingObs = await db.select({ id: s.officials.id, name: s.officials.fullName }).from(s.officials).where(eq(s.officials.type, "COMMISSIONER"));
  const newObs = O.filter((o) => !existingObs.some((e) => words(e.name).join(" ") === words(o.name).join(" ")));
  out.push(`■ مراقبو المباريات: ${O.length} في الكشف — ${newObs.length} يُضافون، ${O.length - newObs.length} موجودون`);
  if (apply) for (const o of newObs) {
    await db.insert(s.officials).values({ fullName: o.name, type: "COMMISSIONER", city: o.branch, notes: `مصنف بالدرجة (${o.grade}) — فرع الاتحاد ${o.branch} — الموسم 2026/2027` });
  }
  const obsList = apply ? await db.select({ id: s.officials.id, name: s.officials.fullName }).from(s.officials).where(eq(s.officials.type, "COMMISSIONER"))
    : [...existingObs, ...newObs.map((o) => ({ id: null as number | null, name: o.name }))];

  // ===== الملاعب والمباريات والتعيينات =====
  const stadiums = await db.select().from(s.stadiums);
  const stad = (n: string) => stadiums.find((x) => nc(x.name) === nc(n));
  const venues = [...new Set(Object.values(L.rounds).flatMap((g) => Object.values(g).flat().map((m) => m.venue)))];
  const newVenues = venues.filter((v) => !stad(v));
  out.push(`■ الملاعب: ${venues.length} — يُضاف إلى السجل: ${newVenues.join("، ") || "لا شيء"}`);
  if (apply) for (const v of newVenues) stadiums.push((await db.insert(s.stadiums).values({ name: v }).returning())[0]);

  let nMatches = 0, nExist = 0, nAssign = 0;
  for (const [g, rounds] of Object.entries(L.rounds)) for (const [r, list] of Object.entries(rounds)) {
    out.push(`■ المجموعة ${g === "أ" ? "الأولى" : "الثانية"} — الأسبوع ${r}: ${list.length} مباريات`);
    for (const m of list) {
      const h = club(m.home)!, a = club(m.away)!;
      const ob = m.observer ? findObserver(m.observer, obsList) : null;
      out.push(`  - ${m.date} ${m.time} ${m.home} × ${m.away} — ${m.venue}${m.observer ? ` — المراقب: ${m.observer}${ob === "AMBIG" ? " ⚠ أكثر من مراقب بهذا الاسم" : !ob ? " ⚠ غير موجود في الكشف" : ` ← ${ob.name}`}` : ""}`);
      if (m.observer && (!ob || ob === "AMBIG")) warn.push(`${m.home} × ${m.away}: المراقب «${m.observer}» ${ob === "AMBIG" ? "يطابق أكثر من اسم" : "غير موجود في كشف المراقبين"} — يُعيَّن يدويًا`);
      if (!apply || !c || !stage1) continue;
      let [mm] = await db.select().from(s.matches).where(and(eq(s.matches.stageId, stage1.id), eq(s.matches.homeClubId, h.id), eq(s.matches.awayClubId, a.id)));
      if (mm) nExist++;
      else {
        const v = stad(m.venue)!;
        [mm] = await db.insert(s.matches).values({ competitionId: c.id, stageId: stage1.id, round: Number(r), groupName: g, homeClubId: h.id, awayClubId: a.id,
          kickoff: kickoff(m), venue: v.name, city: v.city, stadiumId: v.id, notes: m.note }).returning();
        nMatches++;
      }
      if (ob && ob !== "AMBIG" && ob.id) {
        const [as] = await db.select().from(s.assignments).where(and(eq(s.assignments.matchId, mm.id), eq(s.assignments.role, "COMMISSIONER")));
        if (!as) { await db.insert(s.assignments).values({ matchId: mm.id, officialId: ob.id, role: "COMMISSIONER", status: "APPROVED", assignedBy: BY, approvedBy: BY, approvedAt: new Date() }); nAssign++; }
      }
    }
  }
  if (warn.length) out.push("", "■ تنبيهات:", ...warn.map((x) => "  - " + x));
  if (apply) {
    out.unshift(`✓ نُفِّذ: مباريات جديدة ${nMatches} (موجودة ${nExist})، تعيينات مراقبين ${nAssign}`);
    await db.insert(s.auditLogs).values({ userName: BY, action: "إعداد الدوري الممتاز من اللائحة والجداول", entity: "Competition", entityId: String(c!.id), details: JSON.stringify({ nMatches, nAssign, observers: newObs.length }) });
  }
  writeFileSync(reportFile, out.join("\r\n"), "utf8");
  console.log(apply ? out[0] : `✓ الفحص انتهى — لم يتغير شيء. التقرير: ${reportFile}`);
}

if (process.argv[1]?.includes("import-league")) {
  const [mode, a, b, r] = process.argv.slice(2);
  run(mode === "apply", a, b, r).then(() => process.exit(0)).catch((e) => { console.error("✗", e.message ?? e); process.exit(1); });
}
