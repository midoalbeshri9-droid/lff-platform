// إدخال قرارات لجنة المسابقات الصادرة (النتائج، الإنذارات، العقوبات) وحفظ القرارات نفسها صادرة برقمها وتاريخها
// الفحص: npx tsx --require ./scripts/no-server-only.cjs src/db/import-decisions.ts check data/import/decisions-w1-3.json data/decisions-report.txt
// التنفيذ: ... apply ...
// لا يُعيد إدخال قرار موجود برقمه، ولا يعتمد مباراة معتمدة مسبقًا
import "dotenv/config";
import { readFileSync, writeFileSync } from "fs";
import { and, eq, inArray } from "drizzle-orm";
import * as s from "./schema";
import { db } from "./index";
import { approveMatch } from "@/lib/competition";
import { issueSanction } from "@/lib/sanctions";
import { draftFor } from "@/lib/decisions";

type Card = { name: string; card: string; club: string; reason: string };
type StaffCard = { name: string; card: string; club: string; role: string; reason: string };
type Dec = {
  number: string; date: string; round: number; group: string; postponed?: boolean;
  results: { home: string; away: string; hs: number; as: number }[];
  forfeits: { home: string; away: string; loser: string; fine: number; points: number; article: string; reason: string }[];
  players: Card[]; staff: StaffCard[];
  playerSanctions: { name: string; card: string; club: string; matches: number; fine: number; article: string; reason: string }[];
  staffSanctions: { name: string; club: string; role: string; matches: number; fine: number; article: string; reason: string }[];
  clubSanctions: { club: string; fine: number; article: string; reason: string; match: string }[];
  skipped: string[];
};
const BY = "إدخال قرارات لجنة المسابقات";
const COMP = "الدوري الليبي الممتاز";
const SIGNER = "عبد الله علي الشحومي";
const nc = (x: string) => x.replace(/^\s*(نادي|فريق)\s+/, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, "").toLowerCase();
const nn = (x: string) => x.replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/عبد\s+/g, "عبد").replace(/ابو\s+/g, "ابو").replace(/[^\p{L}\s]/gu, " ").replace(/\s+/g, " ").trim().toLowerCase();
function sim(a: string, b: string) {
  if (nn(a).replace(/ /g, "") === nn(b).replace(/ /g, "")) return 1;
  const A = nn(a).split(" "), left = nn(b).split(" "), n = Math.max(A.length, left.length);
  let common = 0;
  for (const w of A) { const i = left.indexOf(w); if (i >= 0) { common++; left.splice(i, 1); } }
  return common / n;
}
const card = (x: string | null | undefined) => {
  const c = (x ?? "").toUpperCase().replace(/\s+/g, "");
  const m = c.match(/^(\d{1,6})M(\d{2})$/); return m ? `${m[1].padStart(6, "0")}M${m[2]}` : c;
};
const ROLE: Record<string, "COACH" | "ASSISTANT_COACH" | "GK_COACH" | "ADMIN" | "OTHER" | "TEAM_MANAGER"> = {
  "مدرب": "COACH", "مدير فني": "COACH", "المدير الفني": "COACH", "مساعد مدرب": "ASSISTANT_COACH", "مدرب حراس": "GK_COACH", "إداري": "ADMIN", "مدير الفريق": "TEAM_MANAGER",
};

async function run(apply: boolean, file: string, reportFile: string) {
  const D = JSON.parse(readFileSync(file, "utf8")) as Dec[];
  const out: string[] = [], warn: string[] = [];
  const [c] = await db.select().from(s.competitions).where(eq(s.competitions.name, COMP)).orderBy(s.competitions.id);
  if (!c) throw new Error("مسابقة الدوري الممتاز غير موجودة — شغّل إعداد الدوري أولًا");
  const [stage] = await db.select().from(s.competitionStages).where(and(eq(s.competitionStages.competitionId, c.id), eq(s.competitionStages.seq, 1)));
  const clubs = await db.select({ id: s.clubs.id, name: s.clubs.name }).from(s.clubs);
  const club = (n: string) => clubs.find((x) => nc(x.name) === nc(n));
  const regs = await db.select({ pid: s.players.id, name: s.players.fullName, en: s.players.fullNameEn, card: s.players.cardNo, club: s.registrations.clubId }).from(s.registrations)
    .innerJoin(s.players, eq(s.players.id, s.registrations.playerId))
    .where(and(eq(s.registrations.seasonId, c.seasonId), eq(s.registrations.status, "APPROVED")));
  const existing = new Set((await db.select({ n: s.roundDecisions.number }).from(s.roundDecisions).where(eq(s.roundDecisions.competitionId, c.id))).map((x) => x.n));

  /** اللاعب في قيود ناديه: رقم البطاقة مع اسم متقارب، وإلا الاسم (والرقم المختلف يُنبَّه إليه) */
  const findPlayer = (p: { name: string; card: string; club: string }, ctx: string) => {
    const cl = club(p.club); if (!cl) { warn.push(`${ctx}: النادي «${p.club}» غير موجود`); return null; }
    const mine = regs.filter((r) => r.club === cl.id);
    const pc = card(p.card);
    const byCard = mine.find((r) => card(r.card) === pc);
    const v = (r: (typeof mine)[number]) => Math.max(sim(r.name, p.name), r.en ? sim(r.en, p.name) : 0);
    if (byCard && v(byCard) >= 0.5) return byCard;
    const byName = mine.map((r) => ({ r, v: v(r) })).sort((a, b) => b.v - a.v)[0];
    if (byName && byName.v >= 0.6) {
      if (pc && card(byName.r.card) !== pc) warn.push(`${ctx}: «${p.name}» رقم بطاقته في القرار ${pc} وفي المنظومة ${byName.r.card ?? "بلا رقم"} — اعتُمد الاسم`);
      return byName.r;
    }
    if (byCard) { warn.push(`${ctx}: رقم البطاقة ${pc} في المنظومة باسم «${byCard.name}» وفي القرار «${p.name}» — اعتُمد رقم البطاقة`); return byCard; }
    warn.push(`${ctx}: «${p.name}» (${pc}) غير موجود في قيود ${p.club} — لم يُسجَّل`);
    return null;
  };
  const matchOf = async (home: string, away: string) => {
    const h = club(home), a = club(away);
    if (!h || !a) return null;
    const [m] = await db.select().from(s.matches).where(and(eq(s.matches.stageId, stage.id), eq(s.matches.homeClubId, h.id), eq(s.matches.awayClubId, a.id)));
    return m ?? null;
  };
  const staffOf = async (x: { name: string; club: string; role: string; card?: string }) => {
    const cl = club(x.club)!;
    const list = await db.select().from(s.staff).where(and(eq(s.staff.clubId, cl.id), eq(s.staff.seasonId, c.seasonId)));
    const hit = list.find((y) => sim(y.fullName, x.name) >= 0.6 || sim(x.name, y.fullName) >= 0.6);
    if (hit || !apply) return hit ?? null;
    const [n] = await db.insert(s.staff).values({ clubId: cl.id, seasonId: c.seasonId, fullName: x.name, role: ROLE[x.role] ?? "OTHER", cardNo: x.card || null, status: "APPROVED" }).returning();
    return n;
  };

  for (const d of D) {
    out.push("", `■ القرار رقم (${d.number}) — ${d.date} — الأسبوع ${d.round}${d.postponed ? " (المؤجلات)" : ""} — المجموعة ${d.group === "أ" ? "الأولى" : "الثانية"}`);
    if (existing.has(d.number)) { out.push("  موجود مسبقًا — لم يُعَد إدخاله"); continue; }
    const ids: number[] = [];
    // النتائج والإنذارات
    for (const r of d.results) {
      const m = await matchOf(r.home, r.away);
      if (!m) { warn.push(`قرار ${d.number}: مباراة ${r.home} × ${r.away} غير موجودة في الجدول`); continue; }
      ids.push(m.id);
      const cards = d.players.filter((p) => [r.home, r.away].some((x) => nc(x) === nc(p.club)));
      const scards = d.staff.filter((p) => [r.home, r.away].some((x) => nc(x) === nc(p.club)));
      out.push(`  - ${r.home} ${r.hs} - ${r.as} ${r.away} — إنذارات: ${cards.length} لاعبين${scards.length ? ` و${scards.length} مرافقين` : ""}${m.reportStatus === "APPROVED" ? " (معتمدة مسبقًا — لن تُعدَّل)" : ""}`);
      const resolved = cards.map((p) => ({ p, r: findPlayer(p, `قرار ${d.number}`) }));
      if (!apply || m.reportStatus === "APPROVED") continue;
      await db.update(s.matches).set({ homeScore: r.hs, awayScore: r.as, status: "PLAYED", reportStatus: "SUBMITTED" }).where(eq(s.matches.id, m.id));
      for (const { p, r: pl } of resolved) if (pl) await db.insert(s.matchEvents).values({ matchId: m.id, clubId: club(p.club)!.id, playerId: pl.pid, type: "YELLOW", note: p.reason });
      for (const x of scards) {
        const st = await staffOf(x);
        await db.insert(s.matchEvents).values({ matchId: m.id, clubId: club(x.club)!.id, staffId: st?.id ?? null, staffName: st ? null : x.name, staffRole: x.role, type: "YELLOW", note: x.reason });
      }
      await db.transaction(async (tx) => { await approveMatch(tx, m.id, `${BY} — قرار ${d.number}`); });
    }
    // الخسارة الاعتبارية
    for (const f of d.forfeits) {
      const m = await matchOf(f.home, f.away);
      if (!m) { warn.push(`قرار ${d.number}: مباراة ${f.home} × ${f.away} غير موجودة`); continue; }
      ids.push(m.id);
      out.push(`  - ${f.home} × ${f.away}: خسارة اعتبارية لـ${f.loser} (0-2) + غرامة ${f.fine} د.ل + خصم ${f.points} نقاط`);
      if (!apply || m.reportStatus === "APPROVED") continue;
      const loser = club(f.loser)!.id;
      await db.transaction(async (tx) => {
        await issueSanction(tx, { targetType: "CLUB", clubId: loser, competitionId: c.id, matchId: m.id, type: "FORFEIT", fineAmount: String(f.fine), articleText: f.article, reason: f.reason, decisionDate: d.date, notes: `قرار لجنة المسابقات رقم (${d.number})` }, BY);
        if (f.points) await issueSanction(tx, { targetType: "CLUB", clubId: loser, competitionId: c.id, matchId: m.id, type: "POINTS_DEDUCTION", points: f.points, articleText: f.article, reason: f.reason, decisionDate: d.date, notes: `قرار لجنة المسابقات رقم (${d.number})` }, BY);
      });
    }
    // العقوبات
    const decMatch = async (cl: string) => {
      for (const r of d.results) if (nc(r.home) === nc(cl) || nc(r.away) === nc(cl)) return matchOf(r.home, r.away);
      return null;
    };
    for (const p of d.playerSanctions) {
      const pl = findPlayer(p, `قرار ${d.number} (عقوبة)`);
      const m = await decMatch(p.club);
      out.push(`  ⚖ لاعب: ${p.name} (${p.club}) — إيقاف ${p.matches} مباراة${p.fine ? ` + غرامة ${p.fine} د.ل` : ""} — ${p.article}`);
      if (!apply || !pl) continue;
      await db.transaction(async (tx) => { await issueSanction(tx, { targetType: "PLAYER", playerId: pl.pid, clubId: club(p.club)!.id, competitionId: c.id, matchId: m?.id ?? null, type: "MATCH_BAN", matchesCount: p.matches, fineAmount: p.fine ? String(p.fine) : null, articleText: p.article, reason: p.reason, decisionDate: d.date, notes: `قرار لجنة المسابقات رقم (${d.number})` }, BY); });
    }
    for (const x of d.staffSanctions) {
      const m = await decMatch(x.club);
      out.push(`  ⚖ مرافق: ${x.role} ${x.name} (${x.club}) — إيقاف ${x.matches} مباراة${x.fine ? ` + غرامة ${x.fine} د.ل` : ""} — ${x.article}`);
      if (!apply) continue;
      const st = await staffOf(x);
      await db.transaction(async (tx) => { await issueSanction(tx, { targetType: "STAFF", staffId: st!.id, clubId: club(x.club)!.id, competitionId: c.id, matchId: m?.id ?? null, type: "MATCH_BAN", matchesCount: x.matches, fineAmount: x.fine ? String(x.fine) : null, articleText: x.article, reason: x.reason, decisionDate: d.date, notes: `قرار لجنة المسابقات رقم (${d.number})` }, BY); });
    }
    for (const x of d.clubSanctions) {
      const [h, a] = x.match.split("|");
      const m = await matchOf(h, a);
      out.push(`  ⚖ نادي: ${x.club} — غرامة ${x.fine} د.ل — ${x.article}`);
      if (!apply) continue;
      await db.transaction(async (tx) => { await issueSanction(tx, { targetType: "CLUB", clubId: club(x.club)!.id, competitionId: c.id, matchId: m?.id ?? null, type: "FINE", fineAmount: String(x.fine), articleText: x.article, reason: x.reason, decisionDate: d.date, notes: `قرار لجنة المسابقات رقم (${d.number})` }, BY); });
    }
    for (const x of d.skipped) out.push(`  ✗ لم يُدخل: ${x}`);
    // القرار نفسه: صادر برقمه وتاريخه
    if (apply && ids.length) {
      const content = await draftFor({ stageId: stage.id, round: d.round, group: d.group, matchIds: ids, postponed: !!d.postponed });
      content.signerName = SIGNER; content.signerTitle = "رئيس لجنة تنظيم المسابقات";
      await db.insert(s.roundDecisions).values({ competitionId: c.id, stageId: stage.id, round: d.round, groupName: d.group, matchIds: ids, number: d.number, issueDate: d.date, status: "ISSUED", content, createdBy: BY, issuedBy: SIGNER, issuedAt: new Date(`${d.date}T12:00:00+02:00`) });
    }
  }
  if (warn.length) out.push("", `■ تنبيهات (${warn.length}):`, ...[...new Set(warn)].map((x) => "  - " + x));
  if (apply) await db.insert(s.auditLogs).values({ userName: BY, action: "إدخال قرارات الأسابيع الأولى", entity: "Competition", entityId: String(c.id), details: JSON.stringify({ decisions: D.map((d) => d.number) }) });
  out.unshift(apply ? "✓ نُفِّذ إدخال القرارات" : "فحص — لم يتغير شيء");
  writeFileSync(reportFile, out.join("\r\n"), "utf8");
  console.log(out[0], `— تنبيهات: ${new Set(warn).size}. التقرير: ${reportFile}`);
}

if (process.argv[1]?.includes("import-decisions")) {
  const [mode, a, r] = process.argv.slice(2);
  run(mode === "apply", a, r).then(() => process.exit(0)).catch((e) => { console.error("✗", e.message ?? e); process.exit(1); });
}
