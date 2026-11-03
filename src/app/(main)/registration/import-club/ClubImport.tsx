"use client";
import { useState } from "react";
import { readWorkbook, cardColumn, findCol, toJpeg, parseDob, yearFromCard, normNat } from "@/lib/xlsxClient";
import { importClubChunk, type ImportResult } from "./actions";
import { setPlayerPhoto } from "../photos/actions";

type P = { key: string; row: number; card: string; name: string; dob: string | null; year: number | null; nat: string; shirt: number | null; photo?: Blob; url?: string; result?: ImportResult; photoMsg?: string };
const norm = (x: string) => x.replace(/^\s*نادي\s+/, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/\s+/g, "");

export function ClubImport({ clubs, divisions, canCreate }: { clubs: { id: number; name: string }[]; divisions: { id: number; name: string }[]; canCreate: boolean; fixedDivision: number | null }) {
  const [rows, setRows] = useState<P[]>([]);
  const [warn, setWarn] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [clubSel, setClubSel] = useState(""); // رقم نادٍ موجود أو "new"
  const [newName, setNewName] = useState("");
  const [divId, setDivId] = useState("");
  const [region, setRegion] = useState("");
  const [approx, setApprox] = useState(true);
  const [done, setDone] = useState(false);

  async function onFile(f: File | undefined) {
    if (!f) return;
    rows.forEach((r) => r.url && URL.revokeObjectURL(r.url));
    setRows([]); setWarn([]); setErr(""); setDone(false);
    try {
      setBusy("جارٍ قراءة الملف ...");
      const ws: string[] = [];
      const sheets = (await readWorkbook(f)).filter((s) => s.cells.size > 1);
      const sh = sheets.find((s) => cardColumn(s.cells) >= 0) ?? sheets[0];
      if (!sh) throw new Error("الملف فارغ");
      const cc = cardColumn(sh.cells), nc = findCol(sh.cells, /full\s*name|^name$|الاسم|أسماء/i), dc = findCol(sh.cells, /تاريخ\s*الميلاد|birth|dob/i);
      const natc = findCol(sh.cells, /national|الجنسية/i), shc = findCol(sh.cells, /shirt|الغلالة|القميص/i), clc = findCol(sh.cells, /^club$|النادي/i);
      if (nc < 0) throw new Error("لم أجد عمود الاسم (FullName أو الاسم)");
      const header = Math.min(...[cc, nc].filter((c) => c >= 0).map((c) => [...sh.cells].find(([, m]) => m.has(c) && /player|البطاقة|name|الاسم|أسماء/i.test(m.get(c)!))?.[0] ?? 1));
      const out: P[] = [];
      const clubNames = new Map<string, number>();
      for (const [r, m] of [...sh.cells].sort((a, b) => a[0] - b[0])) {
        if (r <= header) continue;
        const name = (m.get(nc) ?? "").replace(/\s+/g, " ").trim();
        if (!/[؀-ۿa-zA-Z]{2}/.test(name)) continue;
        const card = cc >= 0 ? (m.get(cc) ?? "").replace(/\s+/g, "").toUpperCase() : "";
        const shirt = shc >= 0 ? parseInt(m.get(shc) ?? "", 10) : NaN;
        if (clc >= 0 && m.get(clc)) clubNames.set(m.get(clc)!, (clubNames.get(m.get(clc)!) ?? 0) + 1);
        out.push({ key: `${r}`, row: r, card, name, dob: dc >= 0 ? parseDob(m.get(dc)) : null, year: yearFromCard(card), nat: normNat(natc >= 0 ? m.get(natc) : ""), shirt: Number.isFinite(shirt) ? shirt : null });
      }
      setBusy("جارٍ استخراج الصور ...");
      for (const im of sh.images) {
        const p = out.find((x) => x.row === im.row);
        if (!p) continue;
        const blob = await toJpeg(im.blob).catch(() => im.blob);
        p.photo = blob; p.url = URL.createObjectURL(blob);
      }
      const seen = new Set<string>();
      for (const p of out) if (p.card) { if (seen.has(p.card)) ws.push(`رقم البطاقة ${p.card} مكرر في الملف (${p.name})`); seen.add(p.card); }
      // النادي: من عمود Club أو اسم الملف
      const guess = [...clubNames].sort((a, b) => b[1] - a[1])[0]?.[0] ?? f.name.replace(/\.xlsx$/i, "").replace(/^\d*\s*(قائمة\s+(فريق\s+)?)?/, "").replace(/\s*بالصور\s*$/, "").trim();
      const hit = clubs.find((c) => norm(c.name) === norm(guess));
      setClubSel(hit ? String(hit.id) : canCreate ? "new" : "");
      setNewName(hit ? "" : guess);
      setRows(out); setWarn(ws);
    } catch (e) { setErr(`تعذرت قراءة الملف: ${(e as Error).message}`); }
    finally { setBusy(""); }
  }

  const effDob = (p: P) => p.dob ?? (approx && p.year ? `${p.year}-01-01` : null);
  const ready = rows.filter((p) => !p.result && effDob(p));
  async function run() {
    setErr("");
    let clubId = clubSel && clubSel !== "new" ? Number(clubSel) : undefined;
    if (!clubId && !(clubSel === "new" && newName.trim())) { setErr("اختر النادي أو اكتب اسم النادي الجديد"); return; }
    const list = ready;
    for (let i = 0; i < list.length; i += 40) {
      setBusy(`جارٍ إدخال اللاعبين ${Math.min(i + 40, list.length)} / ${list.length} ...`);
      const chunk = list.slice(i, i + 40);
      const res = await importClubChunk({
        clubId, newClub: clubId ? undefined : { name: newName, divisionId: divId ? Number(divId) : null, region: region || null },
        rows: chunk.map((p) => ({ card: p.card, name: p.name, dob: effDob(p), approx: !p.dob, nat: p.nat, shirt: p.shirt })),
      }).catch(() => ({ ok: false, msg: "انقطع الاتصال", clubId: undefined, results: [] as ImportResult[] }));
      if (!res.ok) { setErr(res.msg ?? "تعذر الاستيراد"); setBusy(""); return; }
      clubId = res.clubId;
      // النتائج بنفس ترتيب الصفوف المرسلة
      const byKey = new Map(chunk.map((c, j) => [c.key, res.results[j]] as const));
      setRows((prev) => prev.map((p) => (byKey.get(p.key) ? { ...p, result: byKey.get(p.key) } : p)));
      for (const p of chunk) {
        const r = byKey.get(p.key);
        if (!r?.ok || !r.playerId || !p.photo) continue;
        const fd = new FormData();
        fd.set("playerId", String(r.playerId)); fd.set("replace", "0"); fd.set("source", `استيراد نادٍ — الصف ${p.row}`);
        fd.set("photo", new File([p.photo], `${p.card || p.row}.jpg`, { type: p.photo.type || "image/jpeg" }));
        const pr = await setPlayerPhoto(fd).catch(() => ({ ok: false, msg: "تعذر رفع الصورة" }));
        setRows((prev) => prev.map((x) => (x.key === p.key ? { ...x, photoMsg: pr.msg } : x)));
      }
    }
    if (clubId) setClubSel(String(clubId));
    setBusy(""); setDone(true);
  }

  const ok = rows.filter((p) => p.result?.ok).length, fail = rows.filter((p) => p.result && !p.result.ok).length;
  const noDob = rows.filter((p) => !p.dob).length;
  return (
    <>
      <div className="card form">
        <div className="field"><label>ملف Excel للنادي (xlsx)</label>
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => onFile(e.target.files?.[0])} disabled={!!busy} /></div>
        <p className="muted" style={{ margin: 0 }}>الأعمدة المتوقعة: PlayerID (رقم البطاقة)، FullName، تاريخ الميلاد، Nationality، ShirtNumber، Club — والصورة في صف اللاعب. يُقرأ الملف في متصفحك.</p>
        {busy && <div className="alert">{busy}</div>}
        {err && <div className="alert err">{err}</div>}
        {warn.map((w) => <div key={w} className="alert warn">{w}</div>)}
      </div>
      {rows.length > 0 && (
        <div className="card form f3">
          <div className="field"><label>النادي</label>
            <select value={clubSel} onChange={(e) => setClubSel(e.target.value)} disabled={!!busy || done}>
              <option value="">— اختر —</option>
              {canCreate && <option value="new">+ نادٍ جديد</option>}
              {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
          {clubSel === "new" && <>
            <div className="field"><label>اسم النادي الجديد</label><input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} disabled={!!busy || done} /></div>
            <div className="field"><label>الدرجة</label><select value={divId} onChange={(e) => setDivId(e.target.value)} disabled={!!busy || done}>
              <option value="">— غير مصنف —</option>{divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
            <div className="field"><label>المنطقة</label><input type="text" value={region} onChange={(e) => setRegion(e.target.value)} list="regions-imp" disabled={!!busy || done} />
              <datalist id="regions-imp">{["المنطقة الشرقية", "المنطقة الغربية", "المنطقة الجنوبية", "المنطقة الوسطى"].map((r) => <option key={r} value={r} />)}</datalist></div>
          </>}
          {noDob > 0 && (
            <label className="check full"><input type="checkbox" checked={approx} onChange={(e) => setApprox(e.target.checked)} disabled={!!busy || done} />
              {noDob} لاعب بلا تاريخ ميلاد في الملف — أدخلهم بسنة الميلاد من رقم البطاقة (1/1/السنة) مع علامة «تاريخ تقريبي — يُستكمل»</label>)}
          <div className="full row">
            <button className="btn btn-gold" onClick={run} disabled={!!busy || !ready.length || done}>📥 استيراد {ready.length} لاعب</button>
            {(ok > 0 || fail > 0) && <span>أُدخل {ok} — لم يُدخل {fail}</span>}
            {done && clubSel && clubSel !== "new" && <a className="btn btn-light" href={`/registration/players?club=${clubSel}`}>عرض لاعبي النادي</a>}
          </div>
        </div>
      )}
      {rows.length > 0 && (
        <div className="card table-wrap">
          <table className="t"><thead><tr><th>الصورة</th><th>رقم البطاقة</th><th>الاسم</th><th>الميلاد</th><th>الجنسية</th><th>القميص</th><th>النتيجة</th></tr></thead>
            <tbody>{rows.map((p) => (
              <tr key={p.key}>
                <td>{p.url ? <img src={p.url} alt="" style={{ width: 40, height: 50, objectFit: "cover", borderRadius: 4 }} /> : <span className="muted">—</span>}</td>
                <td className="kbd">{p.card || "—"}</td><td>{p.name}</td>
                <td>{p.dob ?? (approx && p.year ? <span className="b b-amber">{p.year} تقريبي</span> : <span className="b b-red">غير موجود</span>)}</td>
                <td>{p.nat}</td><td className="num">{p.shirt ?? "—"}</td>
                <td>{p.result ? <><span className={`b ${p.result.ok ? "b-green" : "b-red"}`}>{p.result.msg}</span>{p.photoMsg && <div className="muted" style={{ fontSize: ".75rem" }}>{p.photoMsg}</div>}</>
                  : effDob(p) ? <span className="b b-blue">جاهز</span> : <span className="b b-gray">لن يُدخل</span>}</td>
              </tr>))}</tbody></table>
        </div>
      )}
    </>
  );
}
