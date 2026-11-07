"use client";
import { useState } from "react";
import { classify, matchFolder, type DocTypeLite, type Dir } from "@/lib/docClassify";
import { toJpeg } from "@/lib/xlsxClient";
import { playerDirectory, uploadPlayerFile } from "@/app/(main)/registration/docs-import/actions";

type F = { key: string; file: File; kind: string; result?: { ok: boolean; msg: string } };
type G = { key: string; folder: string; playerId: number | null; guess: string; files: F[] };

const LIMIT = 4.2 * 1048576; // حد حجم الطلب على الخادم
const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} م.ب` : `${Math.max(1, Math.round(n / 1024))} ك.ب`);
const OK_TYPES = /^(application\/pdf|image\/(jpeg|png|webp))$/;

/** رفع ملفات اللاعب دفعة واحدة: لاعب واحد (playerId) أو مجلد فيه مجلد لكل لاعب (بلا playerId) */
export function PlayerFilesUploader({ types, playerId }: { types: DocTypeLite[]; playerId?: number }) {
  const [groups, setGroups] = useState<G[]>([]);
  const [dir, setDir] = useState<Dir[]>([]);
  const [busy, setBusy] = useState("");
  const [replacePhoto, setReplacePhoto] = useState(false);
  const bulk = !playerId;

  async function onFiles(list: FileList | null) {
    const files = Array.from(list ?? []).filter((f) => !f.name.startsWith(".") && f.name !== "desktop.ini" && f.name !== "Thumbs.db");
    if (!files.length) return;
    const mk = (f: File, i: number): F => ({ key: `${i}-${f.name}`, file: f, kind: OK_TYPES.test(f.type) ? String(classify(f.name, f.type, types)) : "skip" });
    if (!bulk) { setGroups([{ key: "one", folder: "", playerId: playerId!, guess: "", files: files.map(mk) }]); return; }
    setBusy("جارٍ مطابقة المجلدات باللاعبين ...");
    const d = dir.length ? dir : await playerDirectory();
    setDir(d);
    // المجلد الأول تحت المجلد المختار = لاعب؛ وإن كانت الملفات مباشرة في المجلد المختار فهو لاعب واحد
    const by = new Map<string, File[]>();
    for (const f of files) {
      const parts = (f.webkitRelativePath || f.name).split("/");
      const folder = parts.length > 2 ? parts[1] : parts[0];
      by.set(folder, [...(by.get(folder) ?? []), f]);
    }
    let i = 0;
    setGroups([...by].map(([folder, fs]) => {
      const m = matchFolder(folder, d);
      return { key: folder, folder, playerId: m?.player.id ?? null, guess: m ? `${Math.round(m.score * 100)}%` : "", files: fs.map((f) => mk(f, i++)) };
    }));
    setBusy("");
  }

  const setKind = (g: string, f: string, kind: string) => setGroups((p) => p.map((x) => (x.key !== g ? x : { ...x, files: x.files.map((y) => (y.key === f ? { ...y, kind } : y)) })));
  const setPlayer = (g: string, id: number | null) => setGroups((p) => p.map((x) => (x.key === g ? { ...x, playerId: id } : x)));
  const pending = groups.filter((g) => g.playerId).flatMap((g) => g.files.filter((f) => f.kind !== "skip" && !f.result?.ok).map((f) => ({ g, f })));

  async function upload() {
    for (let i = 0; i < pending.length; i++) {
      const { g, f } = pending[i];
      setBusy(`جارٍ الرفع ${i + 1} / ${pending.length} ...`);
      let file = f.file;
      // الصور: تصغير قبل الرفع (الصورة الشخصية 600 بكسل، المستندات 2000 بكسل لتبقى مقروءة)
      if (file.type.startsWith("image/") && (f.kind === "photo" || file.size > 1.5 * 1048576)) {
        const b = await toJpeg(file, f.kind === "photo" ? 600 : 2000, 0.85).catch(() => null);
        if (b) file = new File([b], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" });
      }
      let res: { ok: boolean; msg: string };
      if (file.size > LIMIT) res = { ok: false, msg: `الملف كبير (${kb(file.size)}) — الحد 4 م.ب: اضغط ملف PDF أو قسّمه ثم أعد رفعه` };
      else {
        const fd = new FormData();
        fd.set("playerId", String(g.playerId)); fd.set("kind", f.kind); fd.set("replace", replacePhoto ? "1" : "0"); fd.set("file", file);
        res = await uploadPlayerFile(fd).catch(() => ({ ok: false, msg: "انقطع الاتصال — أعد المحاولة" }));
      }
      setGroups((p) => p.map((x) => (x.key !== g.key ? x : { ...x, files: x.files.map((y) => (y.key === f.key ? { ...y, result: res } : y)) })));
    }
    setBusy("");
    if (!bulk && pending.length) setTimeout(() => window.location.reload(), 1200);
  }

  const done = groups.flatMap((g) => g.files).filter((f) => f.result?.ok).length;
  const failed = groups.flatMap((g) => g.files).filter((f) => f.result && !f.result.ok).length;
  const unmatched = groups.filter((g) => !g.playerId).length;
  const dirLabel = (p: Dir) => `${p.name}${p.club ? ` — ${p.club}` : ""}${p.card ? ` — ${p.card}` : ""}`;
  return (
    <div className="form f1">
      <div className="row" style={{ gap: "1rem", flexWrap: "wrap" }}>
        {bulk ? (
          <div className="field"><label>المجلد الرئيسي (فيه مجلد لكل لاعب)</label>
            {/* @ts-expect-error webkitdirectory غير معرّف في أنواع React */}
            <input type="file" webkitdirectory="" multiple onChange={(e) => onFiles(e.target.files)} disabled={!!busy} /></div>
        ) : (
          <div className="field"><label>ملفات اللاعب (صور أو PDF — اختر عدة ملفات معًا)</label>
            <input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => onFiles(e.target.files)} disabled={!!busy} /></div>
        )}
        <label className="check" style={{ alignSelf: "end" }}><input type="checkbox" checked={replacePhoto} onChange={(e) => setReplacePhoto(e.target.checked)} /> استبدال الصورة الشخصية إن وُجدت</label>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: ".85rem" }}>يُحدَّد نوع كل ملف من اسمه (جواز، عقد، طبي، ITC، شهادة ميلاد، هوية، مخالصة، صورة...) — راجعه وغيّره إن لزم قبل الرفع.{bulk && " ويُطابق كل مجلد باللاعب من رقم البطاقة في اسمه أو من الاسم."}</p>
      {busy && <div className="alert">{busy}</div>}
      {groups.length > 0 && (
        <>
          {bulk && <datalist id="pf-players">{dir.map((p) => <option key={p.id} value={dirLabel(p)} />)}</datalist>}
          {groups.map((g) => (
            <div key={g.key} className="box" style={{ padding: ".6rem", border: "1px solid var(--line, #ddd)", borderRadius: 8 }}>
              {bulk && (
                <div className="row" style={{ gap: ".6rem", alignItems: "center", marginBottom: ".4rem" }}>
                  <strong>📁 {g.folder}</strong> ←
                  <input type="text" list="pf-players" style={{ minWidth: 320 }} placeholder="ابحث عن اللاعب بالاسم أو رقم البطاقة"
                    defaultValue={g.playerId ? dirLabel(dir.find((p) => p.id === g.playerId)!) : ""}
                    onChange={(e) => setPlayer(g.key, dir.find((p) => dirLabel(p) === e.target.value)?.id ?? null)} disabled={!!busy} />
                  {g.playerId ? <span className="b b-green">مطابق {g.guess}</span> : <span className="b b-red">اختر اللاعب</span>}
                  {g.playerId && <a href={`/registration/players/${g.playerId}#docs`} target="_blank" rel="noreferrer" style={{ fontSize: ".8rem" }}>فتح الملف</a>}
                </div>
              )}
              <table className="t"><tbody>{g.files.map((f) => (
                <tr key={f.key}>
                  <td>{f.file.type.startsWith("image/") ? "🖼" : "📄"} {f.file.name} <span className="muted" style={{ fontSize: ".75rem" }}>{kb(f.file.size)}</span></td>
                  <td style={{ width: 260 }}>
                    <select value={f.kind} onChange={(e) => setKind(g.key, f.key, e.target.value)} disabled={!!busy || !!f.result?.ok}>
                      {f.file.type.startsWith("image/") && <option value="photo">الصورة الشخصية للاعب</option>}
                      {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      <option value="skip">— تجاهل هذا الملف —</option>
                    </select></td>
                  <td style={{ width: 220 }}>{f.result ? <span className={`b ${f.result.ok ? "b-green" : "b-red"}`}>{f.result.msg}</span>
                    : f.kind === "skip" ? <span className="muted">{OK_TYPES.test(f.file.type) ? "لن يُرفع" : "نوع غير مدعوم (PDF أو صورة فقط)"}</span> : null}</td>
                </tr>))}</tbody></table>
            </div>
          ))}
          <div className="row">
            <button type="button" className="btn btn-gold" onClick={upload} disabled={!!busy || !pending.length}>📤 رفع {pending.length} ملف</button>
            {bulk && unmatched > 0 && <span className="danger-text">{unmatched} مجلد بلا لاعب — لن تُرفع ملفاته</span>}
            {(done > 0 || failed > 0) && <span>رُفع {done}{failed ? ` — تعذر ${failed}` : ""}</span>}
          </div>
        </>
      )}
    </div>
  );
}
