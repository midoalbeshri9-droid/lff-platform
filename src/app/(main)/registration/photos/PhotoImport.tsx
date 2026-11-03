"use client";
import { useState } from "react";
import { readWorkbook, cardColumn, findCol, toJpeg } from "@/lib/xlsxClient";
import { lookupCards, setPlayerPhoto, type CardMatch } from "./actions";

type Row = { key: string; sheet: string; row: number; card: string; name: string; blob: Blob; url: string; match?: CardMatch; result?: { ok: boolean; msg: string } };

async function parse(file: File): Promise<{ rows: Row[]; warnings: string[] }> {
  const tag = file.name.replace(/\.xlsx$/i, "");
  const warnings: string[] = [];
  const rows: Row[] = [];
  for (const sh of await readWorkbook(file)) {
    for (const u of sh.unsupported) if (u.row > 1) warnings.push(`${tag} — الصف ${u.row}: صيغة الصورة غير مدعومة (${u.ext})`);
    if (!sh.images.length) continue;
    const cardCol = cardColumn(sh.cells), nameCol = findCol(sh.cells, /full\s*name|^name$|الاسم|أسماء/i);
    if (cardCol < 0) { warnings.push(`${tag}: فيها صور لكن لم أجد عمود رقم البطاقة`); continue; }
    for (const im of sh.images) {
      const card = (sh.cells.get(im.row)?.get(cardCol) ?? "").replace(/\s+/g, "").toUpperCase();
      if (!card) { if (im.row > 1) warnings.push(`${tag} — الصف ${im.row}: صورة بلا رقم بطاقة في صفّها`); continue; }
      const blob = await toJpeg(im.blob).catch(() => im.blob);
      rows.push({ key: `${tag}-${sh.name}-${im.row}-${im.media}`, sheet: tag, row: im.row, card, name: nameCol >= 0 ? sh.cells.get(im.row)?.get(nameCol) ?? "" : "", blob, url: URL.createObjectURL(blob) });
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
