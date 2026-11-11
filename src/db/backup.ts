/**
 * النسخ الاحتياطي لقاعدة البيانات واسترجاعها — بدون pg_dump
 *   backup  <folder>            : ينسخ كل جداول المخطط public إلى <folder>/<table>.json + manifest.json
 *   restore <folder> [--force]  : يعيدها إلى قاعدة فارغة أُنشئ هيكلها مسبقًا (drizzle-kit push)
 * القيم تُقرأ نصًّا (col::text) وتُكتب كما هي، فلا تتغير التواريخ أو الأرقام أو JSON بسبب المنطقة الزمنية أو التحويل.
 */
import fs from "fs";
import path from "path";
import { sql } from "drizzle-orm";
import { db } from "./index";

type Col = { name: string; type: string };
type TableInfo = { name: string; columns: Col[]; rows: number };
type Manifest = { app: "lff-platform"; version: 1; createdAt: string; tables: TableInfo[]; order: string[]; deferred: { table: string; column: string }[] };

const rowsOf = (r: unknown) => ((r as { rows?: unknown[] }).rows ?? (r as unknown[])) as Record<string, unknown>[];
const q = async (text: string) => rowsOf(await db.execute(sql.raw(text)));
const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

async function tables(): Promise<{ name: string; columns: Col[] }[]> {
  const t = await q(`select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name`);
  const c = await q(`select table_name, column_name, data_type, udt_name from information_schema.columns where table_schema='public' order by table_name, ordinal_position`);
  // اسم النوع الصالح للتحويل: المصفوفات _text → text[]، والأنواع المعرّفة (enum) بين علامتي تنصيص
  const typ = (y: Record<string, unknown>) => { const u = String(y.udt_name); return y.data_type === "ARRAY" ? `${u.slice(1)}[]` : y.data_type === "USER-DEFINED" ? ident(u) : u; };
  return t.map((x) => ({ name: String(x.table_name), columns: c.filter((y) => y.table_name === x.table_name).map((y) => ({ name: String(y.column_name), type: typ(y) })) }))
    .filter((x) => !x.name.startsWith("__drizzle"));
}

/** ترتيب الجداول بحيث يأتي الجدول المرجعي قبل ما يشير إليه (المفاتيح الأجنبية).
 *  الحلقات (مثل الأندية ↔ الملاعب) تُكسر بعمود مرجعي يقبل الفراغ: يُدخل فارغًا ثم يُملأ بعد إدخال كل الجداول */
async function fkOrder(names: string[]): Promise<{ order: string[]; deferred: { table: string; column: string }[] }> {
  const fks = await q(`select c.relname as child, p.relname as parent, a.attname as col, a.attnotnull as nn
    from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_class p on p.oid=k.confrelid join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=k.conrelid and a.attnum = k.conkey[1]
    where k.contype='f' and n.nspname='public'`);
  const edges = fks.map((f) => ({ child: String(f.child), parent: String(f.parent), col: String(f.col), nn: f.nn === true || f.nn === "t" }))
    .filter((e) => e.child !== e.parent && names.includes(e.child) && names.includes(e.parent));
  const deferred: { table: string; column: string }[] = [];
  const out: string[] = [], done = new Set<string>();
  const live = () => edges.filter((e) => !deferred.some((d) => d.table === e.child && d.column === e.col));
  for (let guard = 0; out.length < names.length && guard < names.length * 3; guard++) {
    const es = live();
    let progressed = false;
    for (const n of names) if (!done.has(n) && es.filter((e) => e.child === n).every((e) => done.has(e.parent))) { out.push(n); done.add(n); progressed = true; }
    if (!progressed) {
      const br = es.find((e) => !done.has(e.child) && !done.has(e.parent) && !e.nn);
      if (!br) break;
      deferred.push({ table: br.child, column: br.col });
    }
  }
  for (const n of names) if (!done.has(n)) out.push(n);
  return { order: out, deferred };
}

async function backup(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  const ts = await tables();
  const { order, deferred } = await fkOrder(ts.map((t) => t.name));
  const info: TableInfo[] = [];
  let total = 0;
  for (const t of ts) {
    const cols = t.columns.map((c) => `${ident(c.name)}::text as ${ident(c.name)}`).join(", ");
    const pk = t.columns.some((c) => c.name === "id") ? ` order by "id"` : "";
    const rows = await q(`select ${cols} from ${ident(t.name)}${pk}`);
    // مصفوفات بدل كائنات: أصغر حجمًا وترتيب الأعمدة محفوظ في manifest
    fs.writeFileSync(path.join(dir, `${t.name}.json`), JSON.stringify(rows.map((r) => t.columns.map((c) => r[c.name] ?? null))));
    info.push({ name: t.name, columns: t.columns, rows: rows.length });
    total += rows.length;
    console.log(`  ✓ ${t.name.padEnd(32)} ${rows.length}`);
  }
  const m: Manifest = { app: "lff-platform", version: 1, createdAt: new Date().toISOString(), tables: info, order, deferred };
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(m, null, 1));
  console.log(`\nDatabase backup OK: ${info.length} tables, ${total} rows -> ${dir}`);
}

async function restore(dir: string, force: boolean) {
  const m: Manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  if (m.app !== "lff-platform") throw new Error("not an lff-platform backup");
  const target = new Map((await tables()).map((t) => [t.name, t]));
  const missing = m.tables.filter((t) => !target.has(t.name)).map((t) => t.name);
  if (missing.length) throw new Error(`target database lacks tables (run drizzle-kit push first): ${missing.join(", ")}`);
  const nonEmpty: string[] = [];
  for (const t of m.tables) if (Number((await q(`select count(*)::int as n from ${ident(t.name)}`))[0].n) > 0) nonEmpty.push(t.name);
  if (nonEmpty.length && !force) throw new Error(`target database is not empty (${nonEmpty.slice(0, 5).join(", ")}...). Use --force to wipe it first.`);
  if (nonEmpty.length) await q(`truncate ${m.tables.map((t) => ident(t.name)).join(", ")} restart identity cascade`);
  const byName = new Map(m.tables.map((t) => [t.name, t]));
  let total = 0;
  const later: { table: string; column: string; ty: string; pairs: [string, string][] }[] = [];
  for (const name of m.order) {
    const t = byName.get(name)!;
    const tcols = new Set(target.get(name)!.columns.map((c) => c.name));
    const ttype = new Map(target.get(name)!.columns.map((c) => [c.name, c.type]));
    const keep = t.columns.map((c, i) => ({ c, i, ty: ttype.get(c.name)! })).filter(({ c }) => tcols.has(c.name)); // أعمدة حُذفت من الهيكل الجديد تُتجاهل
    const data: (string | null)[][] = JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), "utf8"));
    // أعمدة الحلقات: تُدخل فارغة الآن وتُملأ في النهاية
    const idIdx = t.columns.findIndex((c) => c.name === "id");
    for (const d of (m.deferred ?? []).filter((x) => x.table === name)) {
      const ci = t.columns.findIndex((c) => c.name === d.column);
      if (ci < 0 || idIdx < 0 || !tcols.has(d.column)) continue;
      later.push({ table: name, column: d.column, ty: ttype.get(d.column)!, pairs: data.filter((r) => r[ci] != null).map((r) => [r[idIdx]!, r[ci]!]) });
      for (const r of data) r[ci] = null;
    }
    for (let s = 0; s < data.length; s += 200) {
      const chunk = data.slice(s, s + 200);
      const values = sql.join(chunk.map((r) => sql`(${sql.join(keep.map(({ i, ty }) => sql`${r[i]}::text::${sql.raw(ty)}`), sql`, `)})`), sql`, `);
      await db.execute(sql`insert into ${sql.raw(ident(name))} (${sql.raw(keep.map(({ c }) => ident(c.name)).join(", "))}) values ${values}`);
    }
    // إعادة ضبط العدادات التلقائية بعد إدخال المعرّفات كما هي
    if (keep.some(({ c }) => c.name === "id") && data.length) {
      await q(`select setval(pg_get_serial_sequence('${ident(name)}', 'id'), (select max(id) from ${ident(name)})) where pg_get_serial_sequence('${ident(name)}', 'id') is not null`);
    }
    total += data.length;
    console.log(`  ✓ ${name.padEnd(32)} ${data.length}`);
  }
  for (const l of later) {
    for (const [id, v] of l.pairs) await db.execute(sql`update ${sql.raw(ident(l.table))} set ${sql.raw(ident(l.column))} = ${v}::text::${sql.raw(l.ty)} where id = ${id}::text::bigint`);
    if (l.pairs.length) console.log(`  ↻ ${l.table}.${l.column} ${l.pairs.length}`);
  }
  console.log(`\nRestore OK: ${m.tables.length} tables, ${total} rows (backup of ${m.createdAt})`);
}

(async () => {
  const [mode, dir, flag] = process.argv.slice(2);
  if (!dir || !["backup", "restore"].includes(mode)) { console.log("usage: backup|restore <folder> [--force]"); process.exit(1); }
  try {
    if (mode === "backup") await backup(path.resolve(dir));
    else await restore(path.resolve(dir), flag === "--force");
    process.exit(0);
  } catch (e) { const er = e as Error & { cause?: Error }; console.error("FAILED:", (er.cause?.message ?? er.message).slice(0, 400)); process.exit(1); }
})();
