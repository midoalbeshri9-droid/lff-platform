// استيراد قائمة أندية وإسنادها لدرجة — لا يحذف شيئًا ولا يكرر ناديًا موجودًا (المطابقة بالاسم بعد التوحيد)
// الاستخدام: npx tsx src/db/import-clubs.ts scripts/clubs-premier.json
import "dotenv/config";
import { readFileSync } from "fs";
import { eq } from "drizzle-orm";
import * as s from "./schema";
import { db } from "./index";

const norm = (x: string) => x.replace(/^\s*نادي\s+/, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, "");

export async function importClubs(file: string) {
  const { division, clubs } = JSON.parse(readFileSync(file, "utf8")) as { division: string; clubs: string[] };
  let [d] = await db.select().from(s.divisions).where(eq(s.divisions.name, division));
  if (!d) [d] = await db.insert(s.divisions).values({ name: division, level: 1 }).returning();
  const existing = await db.select({ id: s.clubs.id, name: s.clubs.name, d: s.clubs.divisionId }).from(s.clubs);
  const added: string[] = [], linked: string[] = [], kept: string[] = [], other: string[] = [];
  for (const name of clubs) {
    const ex = existing.find((c) => norm(c.name) === norm(name));
    if (!ex) { await db.insert(s.clubs).values({ name, divisionId: d.id }); added.push(name); }
    else if (ex.d == null) { await db.update(s.clubs).set({ divisionId: d.id }).where(eq(s.clubs.id, ex.id)); linked.push(ex.name); }
    else if (ex.d === d.id) kept.push(ex.name);
    else other.push(ex.name);
  }
  await db.insert(s.auditLogs).values({ userName: "النظام", action: "استيراد أندية", entity: "Division", entityId: String(d.id), details: JSON.stringify({ added, linked, kept, other }) });
  console.log(`✓ ${division}: أُضيف ${added.length} نادٍ جديد، وأُسند ${linked.length} نادٍ موجود، و${kept.length} موجود فيها مسبقًا، و${other.length} في درجة أخرى (لم يُنقل)`);
  if (added.length) console.log("  أُضيف: " + added.join("، "));
  if (linked.length) console.log("  أُسند: " + linked.join("، "));
  if (kept.length) console.log("  موجود مسبقًا: " + kept.join("، "));
  if (other.length) console.log("  ⚠ في درجة أخرى — انقله يدويًا من «الدرجات ومديروها» إن لزم: " + other.join("، "));
}

if (process.argv[1]?.includes("import-clubs")) {
  importClubs(process.argv[2] ?? "scripts/clubs-premier.json").then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
