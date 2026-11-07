// مطابقة قيود الموسم مع القوائم النهائية المعتمدة من لجنة أوضاع اللاعبين: كل نادٍ = لاعبو قائمته فقط
// الفحص (لا يغيّر شيئًا):  npx tsx src/db/finalize-squads.ts check data/import/final-lists-2026.json data/squads-report.txt
// التنفيذ (بعد المراجعة):    npx tsx src/db/finalize-squads.ts apply data/squads-plan.json
// التنفيذ: إضافة الأندية الناقصة، إلغاء قيد من ليس في القائمة (بلا حذف للاعب وملفاته)، إضافة الناقصين، نقل المعارين، تحديث أرقام الفانلات
import "dotenv/config";
import { readFileSync, writeFileSync } from "fs";
import { and, eq, inArray, sql } from "drizzle-orm";
import * as s from "./schema";
import { db } from "./index";

type P = { shirt: number | null; card: string; raw?: string; name: string; dob?: string; nat?: string };
type L = { club: string; players: P[] };
const ACTIVE = ["APPROVED", "SUBMITTED", "NEEDS_CORRECTION", "DRAFT"] as const;
const BY = "القوائم النهائية 2026/10/14";
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
/** تشابه الأسماء: نسبة الكلمات المشتركة (تقاطع متعدد) */
function sim(a: string, b: string) {
  if (nn(a).replace(/ /g, "") === nn(b).replace(/ /g, "")) return 1;
  const A = nn(a).split(" "), left = nn(b).split(" "), n = Math.max(A.length, left.length);
  let common = 0;
  for (const w of A) { const i = left.indexOf(w); if (i >= 0) { common++; left.splice(i, 1); } }
  return common / n;
}
/** تاريخ الميلاد كما كُتب في القائمة → YYYY-MM-DD أو null إن كان غير صالح */
function dob(raw?: string) {
  if (!raw) return null;
  const t = raw.replace(/[\\.\s]/g, "/").replace(/-/g, "/").split("/").filter(Boolean).map(Number);
  if (t.length !== 3 || t.some(isNaN)) return null;
  const [y, m, d] = t[0] > 1900 ? t : [t[2], t[1], t[0]];
  if (y < 1960 || y > 2015 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
const LIBYAN = /^ليبي/;

type Plan = {
  season: number; division: string;
  createClubs: string[];
  cancel: { regId: number; player: string; card: string | null; club: string; hasEvents: boolean }[];
  move: { regId: number; playerId: number; player: string; from: string; to: string; shirt: number | null }[];
  add: { club: string; name: string; card: string | null; dob: string; nat: string; shirt: number | null; playerId: number | null }[];
  shirts: { regId: number; shirt: number }[];
};

async function check(listFile: string, reportFile: string) {
  const lists = JSON.parse(readFileSync(listFile, "utf8")) as L[];
  const [se] = await db.select().from(s.seasons).where(eq(s.seasons.isCurrent, true));
  if (!se) throw new Error("لا يوجد موسم حالي");
  const clubs = await db.select({ id: s.clubs.id, name: s.clubs.name }).from(s.clubs);
  const regs = await db.select({ r: s.registrations, p: s.players, club: s.clubs.name }).from(s.registrations)
    .innerJoin(s.players, eq(s.players.id, s.registrations.playerId)).innerJoin(s.clubs, eq(s.clubs.id, s.registrations.clubId))
    .where(and(eq(s.registrations.seasonId, se.id), inArray(s.registrations.status, [...ACTIVE])));
  const allPlayers = await db.select({ id: s.players.id, name: s.players.fullName, card: s.players.cardNo, dob: s.players.dateOfBirth }).from(s.players);
  const plan: Plan = { season: se.id, division: "الدوري الممتاز", createClubs: [], cancel: [], move: [], add: [], shirts: [] };
  const errs: Record<string, string[]> = {};
  const err = (club: string, x: string) => (errs[club] ??= []).push(x);
  const fuzzy: string[] = [], noDob: string[] = [];

  // ===== أخطاء القوائم نفسها =====
  const seen = new Map<string, string[]>();
  for (const l of lists) for (const p of l.players) {
    const c = card(p.card);
    if (c) seen.set(c, [...(seen.get(c) ?? []), `${p.name} (${l.club})`]);
  }
  for (const [c, who] of seen) if (who.length > 1) for (const l of lists) for (const p of l.players)
    if (card(p.card) === c) err(l.club, `رقم البطاقة ${c} مكرر: ${who.join(" / ")}`);
  for (const l of lists) {
    const shirts = new Map<number, string[]>();
    const padded = l.players.filter((p) => /^\d{1,5}M\d{2}$/.test((p.raw ?? p.card ?? "").trim()));
    if (padded.length) err(l.club, `${padded.length} رقم بطاقة مكتوب بدون الأصفار في أوله (مثل «${(padded[0].raw ?? padded[0].card).trim()}» بدل «${card(padded[0].raw ?? padded[0].card)}») — صُحّحت تلقائيًا`);
    for (const p of l.players) {
      const raw = (p.raw ?? p.card ?? "").trim();
      if (!raw) err(l.club, `${p.name}: خانة رقم البطاقة فارغة أو فيها قيمة غير رقم بطاقة`);
      else if (!/^\d{6}M\d{2}$/.test(raw) && !/^\d{1,5}M\d{2}$/.test(raw)) err(l.club, `${p.name}: رقم البطاقة مكتوب «${raw}» بصيغة غير صحيحة${card(raw) !== raw && /^\d{6}M\d{2}$/.test(card(raw)!) ? ` (المقصود غالبًا ${card(raw)})` : ""}`);
      if (p.shirt == null) err(l.club, `${p.name}: بلا رقم فانلة`);
      else shirts.set(p.shirt, [...(shirts.get(p.shirt) ?? []), p.name]);
      if (p.dob !== undefined && !dob(p.dob)) err(l.club, `${p.name}: تاريخ الميلاد مكتوب «${p.dob}» وهو غير صحيح`);
      // آخر رقمين في البطاقة = سنة الميلاد
      const c = card(p.card);
      // رقم مكرر في القوائم: يكفي التنبيه على التكرار (بيانات المنظومة قد تخص اللاعب الآخر)
      const sysP = c && (seen.get(c)?.length ?? 0) < 2 ? allPlayers.find((x) => card(x.card) === c) : undefined;
      const birth = dob(p.dob) ?? sysP?.dob ?? null;
      const src = dob(p.dob) ? "في القائمة" : "في المنظومة";
      const m = c?.match(/M(\d{2})$/);
      if (m && birth && birth.slice(2, 4) !== m[1]) err(l.club, `${p.name}: رقم البطاقة ${c} ينتهي بـ ${m[1]} وسنة الميلاد ${src} ${birth.slice(0, 4)} — أحدهما خطأ`);
      if (sysP && sim(sysP.name, p.name) < 0.5) err(l.club, `${p.name}: رقم البطاقة ${c} مسجل في المنظومة باسم «${sysP.name}»`);
    }
    for (const [n, who] of shirts) if (who.length > 1) err(l.club, `رقم الفانلة ${n} مكرر: ${who.join(" / ")}`);
  }

  // ===== المطابقة مع المنظومة =====
  const listed = new Set<number>(); // قيود مطابقة لاعبًا في قائمة ناديه
  const pendingAdd: { l: L; p: P }[] = [];
  const clubIdOf = (n: string) => clubs.find((x) => nc(x.name) === nc(n))?.id;
  for (const l of lists) {
    const cid = clubIdOf(l.club);
    if (!cid) { plan.createClubs.push(l.club); for (const p of l.players) pendingAdd.push({ l, p }); continue; }
    const mine = regs.filter((x) => x.r.clubId === cid);
    for (const p of l.players) {
      const pc = card(p.card);
      let hit = mine.find((x) => !listed.has(x.r.id) && pc && card(x.p.cardNo) === pc);
      if (!hit) {
        const best = mine.filter((x) => !listed.has(x.r.id) && !(pc && x.p.cardNo && card(x.p.cardNo) !== pc))
          .map((x) => ({ x, v: Math.max(sim(x.p.fullName, p.name), x.p.fullNameEn ? sim(x.p.fullNameEn, p.name) : 0) })).sort((a, b) => b.v - a.v)[0];
        if (best && best.v >= 0.75) { hit = best.x; if (best.v < 1) fuzzy.push(`${l.club}: «${p.name}» ↔ المنظومة «${best.x.p.fullName}»`); }
      }
      if (hit) {
        listed.add(hit.r.id);
        if (p.shirt != null && hit.r.shirtNumber !== p.shirt) plan.shirts.push({ regId: hit.r.id, shirt: p.shirt });
        continue;
      }
      pendingAdd.push({ l, p });
    }
  }
  // من في القائمة وليس له قيد في ناديه: نقل (له قيد مع نادٍ آخر)، أو إضافة
  for (const { l, p } of pendingAdd) {
    const pc = card(p.card);
    const other = regs.find((x) => !listed.has(x.r.id) && ((pc && card(x.p.cardNo) === pc) || sim(x.p.fullName, p.name) === 1) && nc(x.club) !== nc(l.club));
    if (other) {
      listed.add(other.r.id);
      plan.move.push({ regId: other.r.id, playerId: other.p.id, player: other.p.fullName, from: other.club, to: l.club, shirt: p.shirt });
      continue;
    }
    const dup = !!pc && (seen.get(pc)?.length ?? 0) > 1; // رقم مكرر في القوائم: لا يُعتمد للربط ولا يُحفظ
    const existing = pc && !dup ? allPlayers.find((x) => card(x.card) === pc) : allPlayers.find((x) => sim(x.name, p.name) === 1 && !!p.dob && x.dob === dob(p.dob));
    const birth = existing?.dob ?? dob(p.dob);
    if (!birth) { noDob.push(`${l.club}: ${p.name} — ${pc ?? "بلا رقم"}`); continue; }
    plan.add.push({ club: l.club, name: p.name, card: pc && !dup && /^\d{6}M\d{2}$/.test(pc) ? pc : null, dob: birth, nat: p.nat ?? "ليبي", shirt: p.shirt, playerId: existing?.id ?? null });
  }
  // من له قيد ولا يظهر في أي قائمة
  const listClubIds = new Set(lists.map((l) => clubIdOf(l.club)).filter(Boolean));
  for (const x of regs.filter((x) => listClubIds.has(x.r.clubId) && !listed.has(x.r.id))) {
    const [ev] = await db.select({ id: s.matchEvents.id }).from(s.matchEvents).where(eq(s.matchEvents.playerId, x.p.id)).limit(1);
    plan.cancel.push({ regId: x.r.id, player: x.p.fullName, card: x.p.cardNo, club: x.club, hasEvents: !!ev });
  }
  const untouched = clubs.filter((c) => !listClubIds.has(c.id) && regs.some((x) => x.r.clubId === c.id));

  const out: string[] = [];
  out.push(`فحص القوائم النهائية — الموسم ${se.name} — ${new Date().toISOString().slice(0, 16).replace("T", " ")}`);
  out.push(`القوائم: ${lists.length} ناديًا، ${lists.reduce((a, l) => a + l.players.length, 0)} لاعبًا`, "");
  out.push("============ ما سيتم عند التنفيذ ============");
  out.push(`■ أندية تُضاف إلى الدوري الممتاز: ${plan.createClubs.length}`, ...plan.createClubs.map((x) => "  - " + x));
  out.push("", `■ يُلغى قيدهم (لهم قيد وليسوا في القائمة): ${plan.cancel.length}`);
  for (const c of plan.cancel) out.push(`  - ${c.club}: ${c.player} — ${c.card ?? "بلا رقم"}${c.hasEvents ? "  ⚠ له أحداث مباريات" : ""}`);
  out.push("", `■ يُنقل قيدهم إلى النادي الذي تذكره القائمة (إعارة/انتقال): ${plan.move.length}`, ...plan.move.map((m) => `  - ${m.player}: من «${m.from}» إلى «${m.to}»`));
  out.push("", `■ يُضافون (في القائمة وليس لهم قيد): ${plan.add.length}`);
  for (const l of lists) { const a = plan.add.filter((x) => x.club === l.club); if (a.length) out.push(`  ${l.club} (${a.length}): ` + a.map((x) => x.name).join("، ")); }
  out.push("", `■ أرقام فانلات تُحدَّث حسب القائمة: ${plan.shirts.length}`);
  if (noDob.length) out.push("", `■ لم يُضافوا لعدم وجود تاريخ ميلاد صالح (يُضافون يدويًا): ${noDob.length}`, ...noDob.map((x) => "  - " + x));
  if (untouched.length) out.push("", `■ أندية لها قيود وليست في القوائم (لم تُمس): ${untouched.length}`, ...untouched.map((c) => "  - " + c.name));
  if (fuzzy.length) out.push("", `■ طوبقت بالاسم مع اختلاف في الكتابة (للمراجعة): ${fuzzy.length}`, ...fuzzy.map((x) => "  - " + x));
  out.push("", "============ ملاحظات وأخطاء في القوائم النهائية ============");
  const total = Object.values(errs).reduce((a, x) => a + x.length, 0);
  out.push(`(${total} ملاحظة)`);
  for (const l of lists) if (errs[l.club]?.length) { out.push("", `● ${l.club}`); for (const e of [...new Set(errs[l.club])]) out.push("  - " + e); }
  writeFileSync(reportFile, out.join("\r\n"), "utf8");
  writeFileSync(reportFile.replace(/report\.txt$/, "plan.json"), JSON.stringify(plan, null, 1), "utf8");
  console.log(`✓ الفحص انتهى — إلغاء ${plan.cancel.length}، نقل ${plan.move.length}، إضافة ${plan.add.length} لاعبًا و${plan.createClubs.length} أندية، و${total} ملاحظة على القوائم. التقرير: ${reportFile}`);
}

async function apply(planFile: string) {
  const plan = JSON.parse(readFileSync(planFile, "utf8")) as Plan;
  const [se] = await db.select().from(s.seasons).where(eq(s.seasons.id, plan.season));
  let [div] = await db.select().from(s.divisions).where(eq(s.divisions.name, plan.division));
  if (!div) [div] = await db.insert(s.divisions).values({ name: plan.division, level: 1 }).returning();
  const clubsNow = await db.select({ id: s.clubs.id, name: s.clubs.name }).from(s.clubs);
  for (const n of plan.createClubs) if (!clubsNow.some((c) => nc(c.name) === nc(n))) clubsNow.push((await db.insert(s.clubs).values({ name: n, divisionId: div.id }).returning({ id: s.clubs.id, name: s.clubs.name }))[0]);
  const cid = (n: string) => clubsNow.find((c) => nc(c.name) === nc(n))!.id;
  const cats = await db.select().from(s.ageCategories).where(eq(s.ageCategories.isActive, true));
  const catFor = (d: string) => {
    const age = new Date(se.startDate).getFullYear() - new Date(d).getFullYear();
    return cats.filter((c) => c.maxAge != null && age <= c.maxAge).sort((a, b) => a.maxAge! - b.maxAge!)[0]?.id ?? cats.find((c) => c.maxAge == null)?.id ?? null;
  };
  const nextNo = async () => {
    const [r] = await db.insert(s.counters).values({ key: `reg:${se.name}`, value: 1 }).onConflictDoUpdate({ target: s.counters.key, set: { value: sql`${s.counters.value} + 1` } }).returning();
    return `${se.name.slice(0, 4)}-${String(r.value).padStart(5, "0")}`;
  };
  const cancel = async (regId: number, reason: string) => {
    const [r] = await db.select().from(s.registrations).where(eq(s.registrations.id, regId));
    if (!r || !(ACTIVE as readonly string[]).includes(r.status)) return null;
    await db.update(s.registrations).set({ status: "CANCELLED", decisionReason: reason, decidedBy: BY, decidedAt: new Date() }).where(eq(s.registrations.id, regId));
    await db.delete(s.competitionSquads).where(and(eq(s.competitionSquads.playerId, r.playerId), eq(s.competitionSquads.clubId, r.clubId)));
    await db.insert(s.registrationEvents).values({ registrationId: regId, userName: BY, action: "إلغاء القيد", note: reason });
    return r;
  };
  const register = async (playerId: number, club: string, birth: string, shirt: number | null, fromClubId: number | null, note: string) => {
    const [reg] = await db.insert(s.registrations).values({
      playerId, clubId: cid(club), seasonId: se.id, type: fromClubId ? "TRANSFER" : "RENEWAL", status: "APPROVED", number: await nextNo(),
      categoryId: catFor(birth), shirtNumber: shirt, fromClubId, notes: note, submittedAt: new Date(), submittedBy: BY, decidedAt: new Date(), decidedBy: BY,
    }).returning();
    await db.insert(s.registrationEvents).values({ registrationId: reg.id, userName: BY, action: "قيد معتمد من القائمة النهائية", note: reg.number });
  };
  let nCancel = 0, nMove = 0, nAdd = 0, nShirt = 0;
  for (const c of plan.cancel) if (await cancel(c.regId, REASON)) nCancel++;
  for (const m of plan.move) {
    const old = await cancel(m.regId, `منقول إلى ${m.to} حسب القائمة النهائية`);
    if (!old) continue;
    const [p] = await db.select({ dob: s.players.dateOfBirth }).from(s.players).where(eq(s.players.id, m.playerId));
    await register(m.playerId, m.to, p.dob, m.shirt, old.clubId, `من ${m.from} — حسب القائمة النهائية`);
    nMove++;
  }
  for (const a of plan.add) {
    let pid = a.playerId;
    if (!pid && a.card) pid = (await db.select({ id: s.players.id }).from(s.players).where(eq(s.players.cardNo, a.card)))[0]?.id ?? null;
    if (!pid) {
      const latin = /^[\x00-\x7F]+$/.test(a.name);
      pid = (await db.insert(s.players).values({ fullName: a.name, fullNameEn: latin ? a.name : null, cardNo: a.card, dateOfBirth: a.dob, nationality: a.nat, isForeign: !LIBYAN.test(a.nat), notes: "أُضيف من القائمة النهائية" }).returning())[0].id;
    }
    const [has] = await db.select({ id: s.registrations.id }).from(s.registrations).where(and(eq(s.registrations.playerId, pid), eq(s.registrations.seasonId, se.id), inArray(s.registrations.status, [...ACTIVE])));
    if (has) continue;
    await register(pid, a.club, a.dob, a.shirt, null, "مضاف من القائمة النهائية");
    nAdd++;
  }
  for (const x of plan.shirts) { await db.update(s.registrations).set({ shirtNumber: x.shirt }).where(eq(s.registrations.id, x.regId)); nShirt++; }
  const summary = { clubs: plan.createClubs.length, cancel: nCancel, move: nMove, add: nAdd, shirts: nShirt };
  await db.insert(s.auditLogs).values({ userName: BY, action: "تطبيق القوائم النهائية للأندية", entity: "Season", entityId: String(se.id), details: JSON.stringify(summary) });
  console.log(`✓ تم: أندية جديدة ${summary.clubs}، إلغاء ${nCancel}، نقل ${nMove}، إضافة ${nAdd}، تحديث فانلات ${nShirt}`);
}

if (process.argv[1]?.includes("finalize-squads")) {
  const [mode, a, b] = process.argv.slice(2);
  (mode === "apply" ? apply(a) : check(a, b)).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
