"use client";
import { useState } from "react";
import JSZip from "jszip";
import { lookupCards, setPlayerPhoto, type CardMatch } from "./actions";

type Row = { key: string; sheet: string; row: number; card: string; name: string; blob: Blob; url: string; match?: CardMatch; result?: { ok: boolean; msg: string } };

const CARD_RE = /^\d{6}[MF]\d{2}$/i;
const byLocal = (root: Element | Document, name: string) => Array.from(root.getElementsByTagName("*")).filter((e) => e.localName === name);
const xml = async (zip: JSZip, path: string) => {
  const f = zip.file(path);
  return f ? new DOMParser().parseFromString(await f.async("text"), "application/xml") : null;
};
/** يحوّل مسارًا نسبيًا داخل الملف المضغوط (مثل ../media/image1.png) إلى مسار كامل */
const resolve = (base: string, target: string) => {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const p of target.split("/")) p === ".." ? parts.pop() : p !== "." && parts.push(p);
  return parts.join("/");
};
const rels = async (zip: JSZip, path: string) => {
  const relPath = path.replace(/([^/]+)$/, "_rels/$1.rels");
  const d = await xml(zip, relPath);
  const m = new Map<string, { type: string; target: string }>();
  if (d) for (const r of byLocal(d, "Relationship")) m.set(r.getAttribute("Id")!, { type: r.getAttribute("Type") ?? "", target: resolve(path, r.getAttribute("Target") ?? "") });
  return m;
};
const colOf = (ref: string) => ref.replace(/\d+/g, "");
const colIdx = (c: string) => c.split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** تصغير الصورة وتحويلها إلى JPEG (حجم أصغر وشكل موحد) */
async function toJpeg(blob: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const s = Math.min(1, 600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("jpeg"))), "image/jpeg", 0.9));
}

async function parse(file: File): Promise<{ rows: Row[]; warnings: string[] }> {
  const tag = file.name.replace(/\.xlsx$/i, "");
  const zip = await JSZip.loadAsync(file);
  const warnings: string[] = [];
  const ss = await xml(zip, "xl/sharedStrings.xml");
  const shared = ss ? byLocal(ss, "si").map((si) => byLocal(si, "t").map((t) => t.textContent ?? "").join("")) : [];
  const wb = await xml(zip, "xl/workbook.xml");
  const wbRels = await rels(zip, "xl/workbook.xml");
  const sheets = wb ? byLocal(wb, "sheet").map((s) => ({ name: s.getAttribute("name") ?? "", path: wbRels.get(s.getAttribute("r:id") ?? Array.from(s.attributes).find((a) => a.localName === "id")?.value ?? "")?.target ?? "" })) : [];
  const rows: Row[] = [];
  for (const sh of sheets.filter((s) => s.path)) {
    const doc = await xml(zip, sh.path);
    if (!doc) continue;
    // القيم: صف ← عمود ← نص
    const cells = new Map<number, Map<number, string>>();
    for (const c of byLocal(doc, "c")) {
      const ref = c.getAttribute("r") ?? "";
      const r = Number(ref.replace(/\D+/g, "")), col = colIdx(colOf(ref));
      const t = c.getAttribute("t");
      const v = byLocal(c, "v")[0]?.textContent ?? byLocal(c, "t").map((x) => x.textContent).join("");
      const text = (t === "s" ? shared[Number(v)] : v ?? "").toString().trim();
      if (text) { if (!cells.has(r)) cells.set(r, new Map()); cells.get(r)!.set(col, text); }
    }
    // عمود رقم البطاقة: من العنوان، وإلا أول عمود قيمه بشكل رقم البطاقة
    let cardCol = -1, nameCol = -1;
    for (const [, m] of [...cells].slice(0, 10)) for (const [c, v] of m) {
      if (cardCol < 0 && /player\s*id|رقم\s*البطاقة|البطاقة/i.test(v)) cardCol = c;
      if (nameCol < 0 && /full\s*name|^name$|الاسم|أسماء/i.test(v)) nameCol = c;
    }
    if (cardCol < 0) {
      const count = new Map<number, number>();
      for (const [, m] of cells) for (const [c, v] of m) if (CARD_RE.test(v.replace(/\s+/g, ""))) count.set(c, (count.get(c) ?? 0) + 1);
      cardCol = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1;
    }
    const sRels = await rels(zip, sh.path);
    const drawings = [...sRels.values()].filter((r) => r.type.endsWith("/drawing"));
    if (!drawings.length) continue;
    if (cardCol < 0) { warnings.push(`${tag}: فيها صور لكن لم أجد عمود رقم البطاقة`); continue; }
    for (const dr of drawings) {
      const d = await xml(zip, dr.target);
      if (!d) continue;
      const dRels = await rels(zip, dr.target);
      for (const a of [...byLocal(d, "twoCellAnchor"), ...byLocal(d, "oneCellAnchor")]) {
        const from = byLocal(a, "from")[0];
        const blip = byLocal(a, "blip")[0];
        if (!from || !blip) continue;
        const row = Number(byLocal(from, "row")[0]?.textContent ?? -1) + 1;
        const embed = blip.getAttribute("r:embed") ?? Array.from(blip.attributes).find((x) => x.localName === "embed")?.value ?? "";
        const media = dRels.get(embed)?.target;
        const card = (cells.get(row)?.get(cardCol) ?? "").replace(/\s+/g, "").toUpperCase();
        const name = nameCol >= 0 ? cells.get(row)?.get(nameCol) ?? "" : "";
        if (!media || !zip.file(media)) continue;
        if (!/\.(png|jpe?g|gif|bmp|webp)$/i.test(media)) { warnings.push(`${tag} — الصف ${row}: صيغة الصورة غير مدعومة (${media.split(".").pop()})`); continue; }
        if (!card) { warnings.push(`${tag} — الصف ${row}: صورة بلا رقم بطاقة في صفّها`); continue; }
        const raw = await zip.file(media)!.async("blob");
        const blob = await toJpeg(raw).catch(() => raw);
        rows.push({ key: `${tag}-${sh.name}-${row}-${media}`, sheet: tag, row, card, name, blob, url: URL.createObjectURL(blob) });
      }
    }
  }
  if (!rows.length && !warnings.length) warnings.push(`${tag}: لم أجد صورًا مثبّتة على الخلايا. إن كانت الصور «داخل الخلية» (Place in Cell) فاجعلها «فوق الخلايا» (Place over Cells) من Excel ثم أعد المحاولة.`);
  return { rows, warnings };
}

export function PhotoImport() {
  const [rows, setRows] = useState<Row[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [replace, setReplace] = useState(false);
  const [fileName, setFileName] = useState("");

  async function onFiles(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    rows.forEach((r) => URL.revokeObjectURL(r.url));
    setRows([]); setWarnings([]); setFileName(files.length === 1 ? files[0].name : `${files.length} ملفات`);
    try {
      let all: Row[] = []; const ws: string[] = [];
      for (let i = 0; i < files.length; i++) {
        setBusy(`جارٍ قراءة الملفات واستخراج الصور ${i + 1} / ${files.length} ...`);
        try { const res = await parse(files[i]); all = all.concat(res.rows); ws.push(...res.warnings); }
        catch (e) { ws.push(`${files[i].name}: تعذرت قراءته — تأكد أنه بصيغة xlsx (${(e as Error).message})`); }
      }
      // صورة واحدة لكل رقم بطاقة (عند تكرار اللاعب في أكثر من ملف تُعتمد الأولى)
      const seen = new Set<string>();
      const dup = all.filter((r) => (seen.has(r.card) ? true : (seen.add(r.card), false)));
      if (dup.length) ws.push(`${dup.length} صورة مكررة لنفس رقم البطاقة في أكثر من ملف — اعتُمدت الأولى: ${[...new Set(dup.map((d) => d.card))].slice(0, 30).join("، ")}${dup.length > 30 ? " ..." : ""}`);
      const rs = all.filter((r) => !dup.includes(r));
      setBusy("جارٍ مطابقة أرقام البطاقات ...");
      const matches: CardMatch[] = [];
      for (let i = 0; i < rs.length; i += 200) matches.push(...(await lookupCards(rs.slice(i, i + 200).map((r) => r.card))));
      setRows(rs.map((r) => ({ ...r, match: matches.find((m) => m.card === r.card) })).sort((a, b) => Number(!a.match) - Number(!b.match)));
      setWarnings(ws);
    } catch (e) {
      setWarnings([`تعذرت قراءة الملف — تأكد أنه بصيغة xlsx (${(e as Error).message})`]);
    } finally { setBusy(""); }
  }

  const todo = rows.filter((r) => r.match && r.match.inScope && (replace || !r.match.hasPhoto) && !r.result?.ok);
  async function save() {
    for (let i = 0; i < todo.length; i++) {
      const r = todo[i];
      setBusy(`جارٍ الحفظ ${i + 1} / ${todo.length} ...`);
      const fd = new FormData();
      fd.set("playerId", String(r.match!.playerId));
      fd.set("replace", replace ? "1" : "0");
      fd.set("source", `${fileName} — الصف ${r.row}`);
      fd.set("photo", new File([r.blob], `${r.card}.jpg`, { type: r.blob.type || "image/jpeg" }));
      const res = await setPlayerPhoto(fd).catch(() => ({ ok: false, msg: "انقطع الاتصال" }));
      setRows((prev) => prev.map((x) => (x.key === r.key ? { ...x, result: res, match: res.ok && x.match ? { ...x.match, hasPhoto: true } : x.match } : x)));
    }
    setBusy("");
  }

  const matched = rows.filter((r) => r.match).length;
  const done = rows.filter((r) => r.result?.ok).length;
  return (
    <>
      <div className="card form">
        <div className="field"><label>ملفات Excel (xlsx) — يمكن اختيار عدة ملفات معًا</label>
          <input type="file" multiple accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => onFiles(e.target.files)} disabled={!!busy} /></div>
        <p className="muted" style={{ margin: 0 }}>يُقرأ الملف داخل متصفحك، ولا يُرفع إلا صور اللاعبين المطابقين بعد ضغطك «حفظ». يجب أن يكون في الملف عمود لرقم البطاقة (مثل PlayerID) وصورة كل لاعب في صفّه.</p>
        {busy && <div className="alert">{busy}</div>}
        {warnings.map((w) => <div key={w} className="alert warn">{w}</div>)}
      </div>
      {rows.length > 0 && (
        <div className="card table-wrap">
          <div className="card-head">
            <h3>{rows.length} صورة — طابقت {matched} لاعبًا، ولم يُعثر على {rows.length - matched}{done ? ` — حُفظ ${done}` : ""}</h3>
            <div className="row">
              <label className="check"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} disabled={!!busy} /> استبدال الصور الموجودة</label>
              <button className="btn btn-gold" onClick={save} disabled={!!busy || !todo.length}>💾 حفظ {todo.length} صورة</button>
            </div>
          </div>
          <table className="t"><thead><tr><th>الصورة</th><th>رقم البطاقة</th><th>الاسم في الملف</th><th>اللاعب في المنظومة</th><th>الحالة</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.key}>
                <td><img src={r.url} alt="" style={{ width: 48, height: 60, objectFit: "cover", borderRadius: 4 }} /></td>
                <td className="kbd">{r.card}</td>
                <td>{r.name || <span className="muted">—</span>}<div className="muted" style={{ fontSize: ".75rem" }}>{r.sheet} — صف {r.row}</div></td>
                <td>{r.match ? <><a href={`/registration/players/${r.match.playerId}`} target="_blank" rel="noreferrer">{r.match.name}</a><div className="muted" style={{ fontSize: ".8rem" }}>{r.match.club ?? ""}</div></> : <span className="b b-red">غير موجود في المنظومة</span>}</td>
                <td>{r.result ? <span className={`b ${r.result.ok ? "b-green" : "b-red"}`}>{r.result.msg}</span>
                  : !r.match ? "—"
                  : !r.match.inScope ? <span className="b b-gray">خارج نطاق درجتك</span>
                  : r.match.hasPhoto ? <span className="b b-amber">{replace ? "ستُستبدل صورته" : "لديه صورة"}</span>
                  : <span className="b b-blue">ستُضاف</span>}</td>
              </tr>
            ))}</tbody></table>
        </div>
      )}
    </>
  );
}
