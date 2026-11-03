// استيراد القوائم النهائية للاعبين (لاعب + قيد معتمد في الموسم) — لا يحذف شيئًا ولا يكرر لاعبًا أو قيدًا
// الاستخدام: npx tsx src/db/import-players.ts data/import/players.json
import "dotenv/config";
import { readFileSync, writeFileSync } from "fs";
import { and, eq, inArray, sql } from "drizzle-orm";
import * as s from "./schema";
import { db } from "./index";

type Row = { review: boolean; club: string; name: string; card: string | null; dob: string | null; nat: string; foreign: boolean; shirt: number | null; note: string | null; fromClub: string | null };
const norm = (x: string) => x.replace(/^\s*نادي\s+/, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, "").toLowerCase();
const BY = "استيراد القوائم النهائية";
const FREE = new Set(["ف - أ", "ف – أ", "ف  - أ"]);

export async function importPlayers(file: string, reportFile?: string) {
  const data = JSON.parse(readFileSync(file, "utf8")) as { season: string; players: Row[] };
  let [season] = await db.select().from(s.seasons).where(eq(s.seasons.name, data.season));
  if (!season) [season] = await db.select().from(s.seasons).where(eq(s.seasons.isCurrent, true));
  if (!season) throw new Error(`الموسم ${data.season} غير موجود — أنشئه من الإدارة أولًا`);
  const clubs = await db.select({ id: s.clubs.id, name: s.clubs.name }).from(s.clubs);
  const clubId = (n: string) => clubs.find((c) => norm(c.name) === norm(n))?.id;
  const cats = (await db.select().from(s.ageCategories).where(eq(s.ageCategories.isActive, true)));
  const catFor = (dob: string) => {
    const age = new Date(season.startDate).getFullYear() - new Date(dob).getFullYear();
    return cats.filter((c) => c.maxAge != null && age <= c.maxAge).sort((a, b) => a.maxAge! - b.maxAge!)[0]?.id ?? cats.find((c) => c.maxAge == null)?.id ?? null;
  };
  const rep = { added: 0, linked: 0, pending: 0, skipped: [] as string[] };
  const skip = (r: Row, why: string) => rep.skipped.push(`${r.club} — ${r.name}: ${why}`);

  for (const r of data.players) {
    const cid = clubId(r.club);
    if (!cid) { skip(r, "النادي غير موجود في المنظومة"); continue; }
    if (!r.dob) { skip(r, "تاريخ الميلاد غير مقروء في الملف — أدخله يدويًا"); continue; }
    // اللاعب: برقم البطاقة، وإلا بالاسم وتاريخ الميلاد
    let [p] = r.card ? await db.select().from(s.players).where(eq(s.players.cardNo, r.card)) : [];
    if (!p) [p] = await db.select().from(s.players).where(and(eq(s.players.dateOfBirth, r.dob), sql`regexp_replace(${s.players.fullName}, '\\s+', '', 'g') = ${r.name.replace(/\s+/g, "")}`));
    if (p) {
      const [reg] = await db.select({ id: s.registrations.id, c: s.registrations.clubId }).from(s.registrations)
        .where(and(eq(s.registrations.playerId, p.id), eq(s.registrations.seasonId, season.id), inArray(s.registrations.status, ["APPROVED", "SUBMITTED", "NEEDS_CORRECTION", "DRAFT"])));
      if (reg) { if (reg.c !== cid) skip(r, `له قيد في هذا الموسم مع نادٍ آخر (${clubs.find((c) => c.id === reg.c)?.name})`); continue; }
      if (r.card && !p.cardNo) await db.update(s.players).set({ cardNo: r.card }).where(eq(s.players.id, p.id));
      rep.linked++;
    } else {
      const latin = /^[\x00-\x7F]+$/.test(r.name);
      [p] = await db.insert(s.players).values({
        fullName: r.name, fullNameEn: latin ? r.name : null, cardNo: r.card, dateOfBirth: r.dob, nationality: r.nat, isForeign: r.foreign,
        notes: r.note ? `ملاحظة القائمة النهائية: ${r.note}` : null,
      }).returning();
      rep.added++;
    }
    const from = r.fromClub ? clubId(r.fromClub) ?? null : null;
    const isClubNote = !!r.note && !FREE.has(r.note) && !r.review;
    // رقم قيد بصيغة المنظومة (رقم البطاقة يبقى في ملف اللاعب)
    const [ctr] = r.review ? [] : await db.insert(s.counters).values({ key: `reg:${season.name}`, value: 1 })
      .onConflictDoUpdate({ target: s.counters.key, set: { value: sql`${s.counters.value} + 1` } }).returning();
    const regNo = ctr ? `${season.name.slice(0, 4)}-${String(ctr.value).padStart(5, "0")}` : null;
    const [reg] = await db.insert(s.registrations).values({
      playerId: p.id, clubId: cid, seasonId: season.id, type: from || isClubNote ? "TRANSFER" : "RENEWAL",
      status: r.review ? "SUBMITTED" : "APPROVED", number: regNo,
      categoryId: catFor(r.dob), shirtNumber: r.shirt, fromClubId: from,
      notes: [r.note && (isClubNote && !from ? `النادي السابق: ${r.note}` : r.note), "مستورد من القائمة النهائية"].filter(Boolean).join(" — "),
      submittedAt: new Date(), submittedBy: BY, ...(r.review ? {} : { decidedAt: new Date(), decidedBy: BY }),
    }).returning();
    await db.insert(s.registrationEvents).values({ registrationId: reg.id, userName: BY, action: r.review ? "استيراد — محل نظر اللجنة" : "استيراد واعتماد القيد", note: reg.number ?? null });
    if (r.review) rep.pending++;
  }
  await db.insert(s.auditLogs).values({ userName: "النظام", action: "استيراد القوائم النهائية للاعبين", entity: "Season", entityId: String(season.id), details: JSON.stringify(rep) });
  const lines = [
    `✓ الموسم ${season.name}: لاعبون جدد ${rep.added}، ولاعبون موجودون رُبطوا ${rep.linked}، منها ${rep.pending} قيد «محل نظر» بانتظار اللجنة`,
    `  تخطّي ${rep.skipped.length}:`, ...rep.skipped.map((x) => "   - " + x),
  ];
  console.log(lines.join("\n"));
  if (reportFile) writeFileSync(reportFile, lines.join("\r\n"), "utf8");
}

if (process.argv[1]?.includes("import-players")) {
  importPlayers(process.argv[2] ?? "data/import/players.json", process.argv[3]).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
