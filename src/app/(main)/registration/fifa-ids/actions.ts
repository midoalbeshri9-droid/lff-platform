"use server";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { players, staff, officials, clubs, settings } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { attempt, UserError, int, str } from "@/lib/util";
import { audit } from "@/lib/audit";
import { cleanFifaId, normName, cellDate, detectCols } from "@/lib/fifaid";

export type Target = "players" | "staff" | "officials" | "clubs";
type Entity = { ids: number[]; label: string; keys: string[]; fifaId: string | null };
export type ReportRow = { row: number; name: string; fifa: string | null; result: string; match?: string; href?: string };
export type Report = { at: string; target: Target; file: string; applied: boolean; counts: Record<string, number>; rows: ReportRow[] };


async function entities(target: Target): Promise<Entity[]> {
  const nd = (n: string | null | undefined, dob: string | null | undefined) => (n && dob ? [`nd:${normName(n)}|${dob}`] : []);
  if (target === "players") {
    const rows = await db.select({ id: players.id, n: players.fullName, en: players.fullNameEn, nid: players.nationalId, pass: players.passportNo, card: players.cardNo, dob: players.dateOfBirth, f: players.fifaId }).from(players);
    return rows.map((p) => ({ ids: [p.id], label: p.n, fifaId: p.f, keys: [
      ...(p.card ? [`ma:${p.card.trim().toUpperCase()}`] : []), ...(p.nid ? [`nid:${p.nid.trim()}`] : []), ...(p.pass ? [`pass:${p.pass.trim().toUpperCase()}`] : []), ...nd(p.n, p.dob), ...nd(p.en, p.dob)] }));
  }
  if (target === "staff") {
    const rows = await db.select({ id: staff.id, n: staff.fullName, nid: staff.nationalId, dob: staff.dateOfBirth, f: staff.fifaId }).from(staff);
    const g = new Map<string, Entity>();
    for (const s of rows) {
      const k = s.nid ? `nid:${s.nid.trim()}` : `id:${s.id}`;
      const e = g.get(k) ?? { ids: [], label: s.n, fifaId: null, keys: [...(s.nid ? [k] : []), ...nd(s.n, s.dob)] };
      e.ids.push(s.id); e.fifaId = e.fifaId ?? s.f; g.set(k, e);
    }
    return [...g.values()];
  }
  if (target === "officials") {
    const rows = await db.select({ id: officials.id, n: officials.fullName, dob: officials.dateOfBirth, f: officials.fifaId }).from(officials);
    return rows.map((o) => ({ ids: [o.id], label: o.n, fifaId: o.f, keys: [...nd(o.n, o.dob), `n:${normName(o.n)}`] }));
  }
  const rows = await db.select({ id: clubs.id, n: clubs.name, en: clubs.nameEn, code: clubs.code, f: clubs.fifaId }).from(clubs);
  return rows.map((c) => ({ ids: [c.id], label: c.n, fifaId: c.f, keys: [`n:${normName(c.n)}`, ...(c.en ? [`n:${normName(c.en)}`] : []), ...(c.code ? [`code:${c.code.trim().toUpperCase()}`] : [])] }));
}

const HREF: Record<Target, (id: number) => string> = {
  players: (id) => `/registration/players/${id}`, staff: (id) => `/registration/staff/${id}`, officials: () => `/referees/officials`, clubs: () => `/admin/clubs`,
};

/** فحص ملف FIFA Connect المصدّر ومطابقته، ثم (عند الاعتماد) حفظ أرقام FIFA ID */
export async function importFifaIds(f: FormData) {
  const u = await requireUser("reg.edit");
  await attempt("/registration/fifa-ids", async () => {
    const target = String(f.get("target")) as Target;
    if (!["players", "staff", "officials", "clubs"].includes(target)) throw new UserError("اختر نوع البيانات");
    const apply = f.get("mode") === "apply", overwrite = f.get("overwrite") === "on";
    const file = f.get("file") as File | null;
    if (!file || !file.size) throw new UserError("اختر ملف Excel المصدّر من FIFA Connect");
    if (file.size > 20 * 1024 * 1024) throw new UserError("الملف أكبر من 20 ميغابايت");
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    try {
      if (/\.csv$/i.test(file.name)) { const { Readable } = await import("stream"); await wb.csv.read(Readable.from(Buffer.from(await file.arrayBuffer()))); }
      else await wb.xlsx.load(await file.arrayBuffer());
    } catch { throw new UserError("تعذّرت قراءة الملف — احفظه بصيغة xlsx أو csv"); }
    const ws = wb.worksheets[0];
    if (!ws) throw new UserError("الملف فارغ");
    const val = (v: unknown): unknown => (v && typeof v === "object" && "text" in (v as object) ? (v as { text: unknown }).text : v && typeof v === "object" && "result" in (v as object) ? (v as { result: unknown }).result : v);
    // سطر العناوين: أول سطر (من أول 10) فيه عمود FIFA ID
    let hdr = 0, cols = detectCols([]);
    for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
      const hs: string[] = [];
      ws.getRow(r).eachCell({ includeEmpty: true }, (c, i) => { hs[i - 1] = String(val(c.value) ?? ""); });
      const d = detectCols(hs);
      if (d.fifa >= 0) { hdr = r; cols = d; break; }
    }
    if (!hdr) throw new UserError("لم أجد عمود «FIFA ID» في أول 10 أسطر من الملف");
    const ents = await entities(target);
    const idx = new Map<string, Entity[]>();
    for (const e of ents) for (const k of e.keys) idx.set(k, [...(idx.get(k) ?? []), e]);
    const byFifa = new Map(ents.filter((e) => e.fifaId).map((e) => [e.fifaId!, e]));
    const cell = (row: import("exceljs").Row, i: number) => (i >= 0 ? val(row.getCell(i + 1).value) : null);
    const rows: ReportRow[] = [];
    const toSet: { e: Entity; fifa: string; over: boolean; ri: number }[] = [];
    const seen = new Set<string>();
    for (let r = hdr + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const nm = (cols.name >= 0 ? String(cell(row, cols.name) ?? "") : [cell(row, cols.first), cell(row, cols.last)].filter(Boolean).join(" ")).trim();
      const fifa = cleanFifaId(cell(row, cols.fifa));
      if (!nm && !fifa) continue;
      if (!fifa) { rows.push({ row: r, name: nm, fifa: null, result: "NO_ID" }); continue; }
      const dob = cellDate(cell(row, cols.dob));
      const nid = String(cell(row, cols.nid) ?? "").trim(), pass = String(cell(row, cols.pass) ?? "").trim().toUpperCase();
      const keys: string[] = [];
      const ma = String(cell(row, cols.ma) ?? "").trim().toUpperCase();
      if (ma) keys.push(`ma:${ma}`); // MA ID Number في FIFA Connect = رقم البطاقة في المنظومة
      if (nid) keys.push(`nid:${nid}`);
      if (pass) keys.push(`pass:${pass}`);
      if (nm && dob) keys.push(`nd:${normName(nm)}|${dob}`);
      if (cols.first >= 0 && cols.last >= 0 && dob) keys.push(`nd:${normName(`${cell(row, cols.last) ?? ""} ${cell(row, cols.first) ?? ""}`)}|${dob}`);
      if (nm) keys.push(`n:${normName(nm)}`);
      let hit: Entity | null = null, amb = false;
      for (const k of keys) {
        const c = idx.get(k);
        if (!c?.length) continue;
        if (c.length === 1) { hit = c[0]; amb = false; break; }
        amb = true;
      }
      if (!hit) { rows.push({ row: r, name: nm, fifa, result: amb ? "AMBIGUOUS" : "NOT_FOUND" }); continue; }
      const base = { row: r, name: nm, fifa, match: hit.label, href: HREF[target](hit.ids[0]) };
      const other = byFifa.get(fifa);
      if (hit.fifaId === fifa) { rows.push({ ...base, result: "SAME" }); continue; }
      if ((other && other !== hit) || seen.has(fifa)) { rows.push({ ...base, result: "TAKEN" }); continue; }
      seen.add(fifa);
      if (hit.fifaId) { rows.push({ ...base, result: "CONFLICT" }); if (overwrite) toSet.push({ e: hit, fifa, over: true, ri: rows.length - 1 }); continue; }
      if (toSet.some((x) => x.e === hit)) { rows.push({ ...base, result: "AMBIGUOUS" }); continue; } // نفس الشخص بسطرين برقمين مختلفين
      rows.push({ ...base, result: "NEW" });
      toSet.push({ e: hit, fifa, over: false, ri: rows.length - 1 });
    }
    if (apply && toSet.length) {
      const tbl = { players, staff, officials, clubs }[target];
      await db.transaction(async (tx) => {
        for (const s of toSet) await tx.update(tbl).set({ fifaId: s.fifa } as never).where(inArray(tbl.id, s.e.ids));
      });
      for (const t of toSet) rows[t.ri].result = t.over ? "OVERWRITTEN" : "SET";
      await audit(u, "استيراد أرقام FIFA ID", "FifaImport", 0, { target, file: file.name, set: toSet.length });
    }
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.result] = (counts[r.result] ?? 0) + 1;
    const rep: Report = { at: new Date().toISOString(), target, file: file.name, applied: apply, counts, rows: rows.slice(0, 3000) };
    const key = `fifa_import:${u.id}`;
    await db.insert(settings).values({ key, value: JSON.stringify(rep) }).onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(rep) } });
    return apply ? `تم الحفظ: ${toSet.length} رقم FIFA ID` : `اكتمل الفحص: ${counts.NEW ?? 0} جاهز للإضافة — راجع التقرير ثم اضغط «حفظ الأرقام»`;
  });
}

/** تعديل رقم FIFA ID يدويًا لشخص أو نادٍ */
export async function setFifaId(f: FormData) {
  const u = await requireUser("reg.edit");
  const target = String(f.get("target")) as Target, id = int(f, "id")!;
  const back = String(f.get("back") ?? "/registration/fifa-ids");
  await attempt(back, async () => {
    const raw = str(f, "fifaId");
    const fifa = raw ? cleanFifaId(raw) : null;
    if (raw && !fifa) throw new UserError("رقم FIFA ID غير صحيح (حروف وأرقام إنجليزية فقط)");
    const tbl = { players, staff, officials, clubs }[target];
    if (!tbl) throw new UserError("نوع غير صحيح");
    if (fifa) {
      const [dup] = await db.select({ id: tbl.id }).from(tbl).where(eq(tbl.fifaId, fifa)).limit(1);
      if (dup && dup.id !== id && target !== "staff") throw new UserError("هذا الرقم مسجّل لسجل آخر");
    }
    await db.update(tbl).set({ fifaId: fifa } as never).where(eq(tbl.id, id));
    await audit(u, "تعديل رقم FIFA ID", target, id, fifa);
    return fifa ? `حُفظ رقم FIFA ID: ${fifa}` : "حُذف رقم FIFA ID";
  });
}
