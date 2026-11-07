// مطابقة قيود اللاعبين مع القوائم النهائية المعتمدة من لجنة أوضاع اللاعبين
// الفحص (لا يغيّر شيئًا):  npx tsx src/db/finalize-squads.ts check data/import/final-lists-2026.json data/squads-report.txt
// التنفيذ (بعد المراجعة):    npx tsx src/db/finalize-squads.ts apply data/squads-plan.json
// التنفيذ = إلغاء قيد الموسم لمن ليس في القائمة (لا حذف للاعب ولا لملفاته — يمكن إعادته)
import "dotenv/config";
import { readFileSync, writeFileSync } from "fs";
import { and, eq, inArray } from "drizzle-orm";
import * as s from "./schema";
import { db } from "./index";

type L = { club: string; players: { shirt: number | null; card: string; name: string }[] };
const ACTIVE = ["APPROVED", "SUBMITTED", "NEEDS_CORRECTION", "DRAFT"] as const;
const REASON = "غير مدرج في القائمة النهائية المعتمدة من لجنة أوضاع اللاعبين وانتقالاتهم (2026/10/14)";
const nc = (x: string) => x.replace(/^\s*(نادي|فريق)\s+/, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, "").toLowerCase();
const nn = (x: string) => x.replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/عبد\s+/g, "عبد").replace(/[^\p{L}\s]/gu, " ").replace(/\s+/g, " ").trim().toLowerCase();
/** رقم البطاقة بصيغة واحدة: 001110M00 (يقبل M00001110 و 1110M00) */
export function card(x: string | null | undefined) {
  const c = (x ?? "").toUpperCase().replace(/\s+/g, "");
  let m = c.match(/^M(\d{2})(\d{4,6})$/); if (m) return `${m[2].padStart(6, "0")}M${m[1]}`;
  m = c.match(/^(\d{1,6})M(\d{2})$/); if (m) return `${m[1].padStart(6, "0")}M${m[2]}`;
  return c || null;
}
/** تشابه الأسماء: نسبة الكلمات المشتركة */
function sim(a: string, b: string) {
  const A = nn(a).split(" "), B = nn(b).split(" ");
  if (nn(a).replace(/ /g, "") === nn(b).replace(/ /g, "")) return 1;
  // تقاطع متعدد (الكلمة المكررة تُحسب بقدر تكرارها في الطرفين)
  const left = [...B]; let common = 0;
  for (const w of A) { const i = left.indexOf(w); if (i >= 0) { common++; left.splice(i, 1); } }
  return common / Math.max(A.length, B.length);
}

async function season() {
  const [x] = await db.select().from(s.seasons).where(eq(s.seasons.isCurrent, true));
  if (!x) throw new Error("لا يوجد موسم حالي");
  return x;
}

async function check(listFile: string, reportFile: string) {
  const lists = JSON.parse(readFileSync(listFile, "utf8")) as L[];
  const se = await season();
  const clubs = await db.select({ id: s.clubs.id, name: s.clubs.name, div: s.clubs.divisionId }).from(s.clubs);
  const regs = await db.select({ r: s.registrations, p: s.players, club: s.clubs.name }).from(s.registrations)
    .innerJoin(s.players, eq(s.players.id, s.registrations.playerId)).innerJoin(s.clubs, eq(s.clubs.id, s.registrations.clubId))
    .where(and(eq(s.registrations.seasonId, se.id), inArray(s.registrations.status, [...ACTIVE])));
  const out: string[] = [];
  const plan = { season: se.id, cancel: [] as { regId: number; player: string; card: string | null; club: string; hasEvents: boolean }[] };
  const notInSystem: string[] = [], otherClub: string[] = [], fuzzy: string[] = [], missingClubs: string[] = [];
  const pending: { x: (typeof regs)[number]; club: string }[] = [];
  const listClubIds = new Set<number>();
  const elsewhere = new Set<number>(); // لاعبون في قائمة نادٍ آخر (إعارة/انتقال) — لا يُلغى قيدهم ويُنبَّه إليهم
  for (const l of lists) {
    const c = clubs.find((x) => nc(x.name) === nc(l.club));
    if (!c) { missingClubs.push(`${l.club} (${l.players.length} لاعبًا)`); continue; }
    listClubIds.add(c.id);
    const mine = regs.filter((x) => x.r.clubId === c.id);
    const used = new Set<number>();
    for (const p of l.players) {
      const pc = card(p.card);
      let hit = mine.find((x) => !used.has(x.r.id) && pc && card(x.p.cardNo) === pc);
      if (!hit) {
        // بالاسم فقط إن لم يتعارض رقما البطاقتين
        const best = mine.filter((x) => !used.has(x.r.id) && !(pc && x.p.cardNo && card(x.p.cardNo) !== pc)).map((x) => ({ x, v: sim(x.p.fullName, p.name) + (x.p.fullNameEn ? sim(x.p.fullNameEn, p.name) : 0) })).sort((a, b) => b.v - a.v)[0];
        if (best && best.v >= 0.75 && sim(best.x.p.fullName, p.name) >= 0.6) { hit = best.x; if (best.v < 1) fuzzy.push(`${l.club}: «${p.name}» (${p.card || "بلا رقم"}) ↔ المنظومة «${best.x.p.fullName}» (${best.x.p.cardNo ?? "بلا رقم"})`); }
      }
      if (hit) { used.add(hit.r.id); continue; }
      const else_ = regs.find((x) => x.r.clubId !== c.id && ((pc && card(x.p.cardNo) === pc) || sim(x.p.fullName, p.name) === 1));
      if (else_) elsewhere.add(else_.r.id);
      if (else_) otherClub.push(`${p.name} (${p.card}) — في قائمة «${l.club}» لكن قيده في المنظومة مع «${else_.club}»`);
      else notInSystem.push(`${l.club}: ${p.name} — ${p.card || "بلا رقم"}${p.shirt ? ` — الفانلة ${p.shirt}` : ""}`);
    }
    pending.push(...mine.filter((x) => !used.has(x.r.id)).map((x) => ({ x, club: l.club })));
  }
  for (const { x, club } of pending) {
    if (elsewhere.has(x.r.id)) continue;
    {
      const [ev] = await db.select({ id: s.matchEvents.id }).from(s.matchEvents).where(eq(s.matchEvents.playerId, x.p.id)).limit(1);
      plan.cancel.push({ regId: x.r.id, player: x.p.fullName, card: x.p.cardNo, club, hasEvents: !!ev });
    }
  }
  const premier = clubs.filter((c) => !listClubIds.has(c.id) && regs.some((x) => x.r.clubId === c.id));
  out.push(`فحص القوائم النهائية — الموسم ${se.name} — ${new Date().toISOString().slice(0, 16)}`);
  out.push(`القوائم: ${lists.length} ناديًا، ${lists.reduce((a, l) => a + l.players.length, 0)} لاعبًا`, "");
  out.push(`■ سيُلغى قيدهم (في المنظومة وليسوا في القائمة): ${plan.cancel.length}`);
  for (const c of plan.cancel) out.push(`  - ${c.club}: ${c.player} — ${c.card ?? "بلا رقم"}${c.hasEvents ? "  ⚠ له أحداث مباريات" : ""}`);
  out.push("", `■ في القائمة وغير موجودين في المنظومة (يحتاجون إضافة): ${notInSystem.length}`, ...notInSystem.map((x) => "  - " + x));
  out.push("", `■ في القائمة لنادٍ وقيدهم مع نادٍ آخر (لم يُلغَ قيدهم — يحتاجون تسجيل إعارة/انتقال): ${otherClub.length}`, ...otherClub.map((x) => "  - " + x));
  out.push("", `■ أندية القوائم غير الموجودة في المنظومة: ${missingClubs.length}`, ...missingClubs.map((x) => "  - " + x));
  out.push("", `■ أندية لها قيود في المنظومة وليست في القوائم (لم تُمس): ${premier.length}`, ...premier.map((c) => `  - ${c.name} (${regs.filter((x) => x.r.clubId === c.id).length})`));
  out.push("", `■ مطابقات بالاسم مع اختلاف بسيط (للمراجعة): ${fuzzy.length}`, ...fuzzy.map((x) => "  - " + x));
  writeFileSync(reportFile, out.join("\n"), "utf8");
  writeFileSync(reportFile.replace(/report\.txt$/, "plan.json"), JSON.stringify(plan, null, 1), "utf8");
  console.log(`✓ الفحص انتهى — سيُلغى ${plan.cancel.length} قيدًا عند التنفيذ. التقرير: ${reportFile}`);
}

async function apply(planFile: string) {
  const plan = JSON.parse(readFileSync(planFile, "utf8")) as { season: number; cancel: { regId: number }[] };
  const ids = plan.cancel.map((x) => x.regId);
  if (!ids.length) { console.log("لا شيء لإلغائه"); return; }
  const regs = await db.select().from(s.registrations).where(and(inArray(s.registrations.id, ids), eq(s.registrations.seasonId, plan.season), inArray(s.registrations.status, [...ACTIVE])));
  for (const r of regs) {
    await db.update(s.registrations).set({ status: "CANCELLED", decisionReason: REASON, decidedBy: "القوائم النهائية", decidedAt: new Date() }).where(eq(s.registrations.id, r.id));
    await db.delete(s.competitionSquads).where(and(eq(s.competitionSquads.playerId, r.playerId), eq(s.competitionSquads.clubId, r.clubId)));
  }
  await db.insert(s.auditLogs).values({ userName: "القوائم النهائية", action: "إلغاء قيود غير المدرجين في القوائم النهائية", entity: "Registration", details: JSON.stringify({ count: regs.length, ids: regs.map((r) => r.id) }) });
  console.log(`✓ أُلغي ${regs.length} قيدًا`);
}

if (process.argv[1]?.includes("finalize-squads")) {
  const [mode, a, b] = process.argv.slice(2);
  (mode === "apply" ? apply(a) : check(a, b)).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
