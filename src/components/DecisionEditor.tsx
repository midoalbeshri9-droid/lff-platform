"use client";
import { useRef, useState } from "react";
import type { DecisionContent, DecisionRow } from "@/db/schema";

type Col = { k: string; label: string; w?: number; list?: string };
const PLAYER_COLS: Col[] = [{ k: "name", label: "اسم الرياضي" }, { k: "cardNo", label: "رقم البطاقة", w: 120 }, { k: "category", label: "الفئة", w: 80 }, { k: "club", label: "الفريق التابع له", w: 130, list: "dec-clubs" }, { k: "opponent", label: "الفريق المتبارى معه", w: 130, list: "dec-clubs" }, { k: "reason", label: "سبب الإنذار", w: 170, list: "dec-reasons" }];
const STAFF_COLS: Col[] = [{ k: "name", label: "اسم المرافق" }, { k: "cardNo", label: "رقم البطاقة", w: 100 }, { k: "category", label: "الفئة", w: 80 }, { k: "club", label: "الفريق التابع له", w: 130, list: "dec-clubs" }, { k: "role", label: "الصفة", w: 120, list: "dec-roles" }, { k: "reason", label: "سبب الإنذار", w: 170, list: "dec-reasons" }];
const RED_COLS: Col[] = [{ k: "name", label: "اسم الرياضي" }, { k: "cardNo", label: "رقم البطاقة", w: 120 }, { k: "club", label: "الفريق التابع له", w: 130, list: "dec-clubs" }, { k: "opponent", label: "الفريق المتبارى معه", w: 130, list: "dec-clubs" }, { k: "reason", label: "السبب", w: 150, list: "dec-reasons" }, { k: "ban", label: "الإيقاف", w: 90 }];
const RES_COLS: Col[] = [{ k: "teams", label: "الفريقان المتباريان" }, { k: "score", label: "النتيجة", w: 90 }, { k: "result", label: "", w: 230 }];

function Rows({ cols, rows, onChange, addLabel }: { cols: Col[]; rows: DecisionRow[]; onChange: (r: DecisionRow[]) => void; addLabel: string }) {
  const set = (i: number, k: string, v: string) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const move = (i: number, d: number) => { const n = [...rows]; const j = i + d; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j], n[i]]; onChange(n); };
  return (
    <div className="table-wrap">
      <table className="t dec-t"><thead><tr><th style={{ width: 34 }}>ت</th>{cols.map((c) => <th key={c.k} style={c.w ? { width: c.w } : undefined}>{c.label}</th>)}<th style={{ width: 86 }}></th></tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i} style={r.manual ? { background: "#fffbe6" } : undefined}>
            <td className="num">{i + 1}</td>
            {cols.map((c) => <td key={c.k}><input type="text" value={r[c.k] ?? ""} list={c.list} onChange={(e) => set(i, c.k, e.target.value)} style={{ width: "100%" }} dir={c.k === "score" ? "ltr" : undefined} /></td>)}
            <td style={{ whiteSpace: "nowrap" }}>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => move(i, -1)} title="أعلى">▲</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => move(i, 1)} title="أسفل">▼</button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange(rows.filter((_, j) => j !== i))} title="حذف">✕</button>
            </td>
          </tr>))}</tbody></table>
      <button type="button" className="btn btn-sm btn-light mt" onClick={() => onChange([...rows, { ...Object.fromEntries(cols.map((c) => [c.k, c.k === "category" ? (rows[0]?.category ?? "أكابر") : ""])), manual: "1" }])}>+ {addLabel}</button>
      {rows.some((r) => r.manual) && <span className="muted" style={{ fontSize: ".8rem", marginInlineStart: 8 }}>الصفوف المظللة مضافة يدويًا وتبقى عند التحديث من بيانات المنظومة</span>}
    </div>
  );
}

const recount = (intro: string, n: number) => intro.replace(/وعددهم \(\d+\)/, `وعددهم (${n})`);

export function DecisionEditor({ id, initial, number, issueDate, clubs, roles, reasons, action, printHref }: {
  id: number; initial: DecisionContent; number: string; issueDate: string; clubs: string[]; roles: string[]; reasons: string[];
  action: (f: FormData) => Promise<void>; printHref: string;
}) {
  const [c, setC] = useState<DecisionContent>(initial);
  const op = useRef<HTMLInputElement>(null);
  const go = (v: string, ask?: string) => (e: React.MouseEvent) => { if (ask && !confirm(ask)) { e.preventDefault(); return; } op.current!.value = v; };
  const up = <K extends keyof DecisionContent>(k: K, v: DecisionContent[K]) => setC((p) => ({ ...p, [k]: v }));
  const T = (k: "subject" | "resultsIntro" | "playersIntro" | "staffIntro" | "redsIntro" | "closing", rows = 2) =>
    <textarea rows={rows} value={c[k]} onChange={(e) => up(k, e.target.value)} style={{ width: "100%" }} />;
  return (
    <form action={action} className="stack">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="op" ref={op} defaultValue="save" />
      <input type="hidden" name="content" value={JSON.stringify(c)} />
      <datalist id="dec-clubs">{clubs.map((x) => <option key={x} value={x} />)}</datalist>
      <datalist id="dec-roles">{roles.map((x) => <option key={x} value={x} />)}</datalist>
      <datalist id="dec-reasons">{reasons.map((x) => <option key={x} value={x} />)}</datalist>

      <div className="card form f3">
        <div className="field"><label>رقم القرار</label><input type="text" name="number" defaultValue={number} placeholder="تلقائي عند الإصدار" /></div>
        <div className="field"><label>تاريخ الصدور</label><input type="date" name="issueDate" defaultValue={issueDate} /></div>
        <div className="field full"><label>الموضوع</label>{T("subject")}</div>
      </div>

      <div className="card"><h3>بعد الاطلاع</h3>
        <p className="muted" style={{ fontSize: ".82rem", margin: 0 }}>كل سطر بند مستقل — تُحفظ هذه البنود وتُستخدم تلقائيًا في القرارات التالية للمسابقة.</p>
        <textarea rows={Math.max(6, c.preamble.length + 1)} value={c.preamble.join("\n")} onChange={(e) => up("preamble", e.target.value.split("\n"))} style={{ width: "100%", lineHeight: 1.8 }} />
      </div>

      <div className="card"><h3>المادة (1): اعتماد النتائج</h3>
        {T("resultsIntro")}
        {c.results.map((g, gi) => (
          <div key={gi} className="mt">
            {(c.results.length > 1 || g.group) && <input type="text" value={g.group} onChange={(e) => up("results", c.results.map((x, j) => (j === gi ? { ...x, group: e.target.value } : x)))} style={{ fontWeight: 700 }} placeholder="عنوان المجموعة" />}
            <Rows cols={RES_COLS} rows={g.rows} onChange={(r) => up("results", c.results.map((x, j) => (j === gi ? { ...x, rows: r } : x)))} addLabel="مباراة" />
          </div>
        ))}
        <p className="muted" style={{ fontSize: ".8rem" }}>النتيجة تُكتب «الضيف - المضيف» لتظهر في الطباعة من اليمين: المضيف ثم الضيف.</p>
      </div>

      <div className="card"><h3>المادة (2): بطاقات الإنذار — 1- الرياضيون ({c.players.length})</h3>
        {T("playersIntro")}
        <Rows cols={PLAYER_COLS} rows={c.players} onChange={(r) => { up("players", r); up("playersIntro", recount(c.playersIntro, r.length)); }} addLabel="لاعب يدويًا" />
      </div>
      <div className="card"><h3>2- المرافقون (الجهاز الفني والإداري) ({c.staff.length})</h3>
        {T("staffIntro")}
        <Rows cols={STAFF_COLS} rows={c.staff} onChange={(r) => { up("staff", r); up("staffIntro", recount(c.staffIntro, r.length)); }} addLabel="مرافق يدويًا" />
      </div>
      <div className="card"><h3>3- حالات الطرد ({c.reds.length})</h3>
        <p className="muted" style={{ fontSize: ".82rem", margin: 0 }}>تظهر في القرار فقط إن وُجدت صفوف.</p>
        {T("redsIntro")}
        <Rows cols={RED_COLS} rows={c.reds} onChange={(r) => { up("reds", r); up("redsIntro", recount(c.redsIntro, r.length)); }} addLabel="حالة طرد يدويًا" />
      </div>

      <div className="card"><h3>عقوبات الأندية ({c.clubSanctions.length})</h3>
        {c.clubSanctions.map((s, i) => (
          <div key={i} className="row" style={{ alignItems: "start" }}><strong>{i + 1}-</strong>
            <textarea rows={2} value={s} onChange={(e) => up("clubSanctions", c.clubSanctions.map((x, j) => (j === i ? e.target.value : x)))} style={{ flex: 1 }} />
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => up("clubSanctions", c.clubSanctions.filter((_, j) => j !== i))}>✕</button></div>
        ))}
        <button type="button" className="btn btn-sm btn-light" onClick={() => up("clubSanctions", [...c.clubSanctions, "يعاقب نادي () بغرامة مالية قدرها ( د.ل) ، وذلك طبقًا لنص المادة () الفقرة () من لائحة الجزاءات."])}>+ عقوبة نادٍ</button>
      </div>

      <div className="card"><h3>مواد إضافية</h3>
        {c.extra.map((e, i) => (
          <div key={i} className="stack" style={{ borderBottom: "1px dashed #ddd", paddingBottom: 6 }}>
            <div className="row"><input type="text" value={e.title} placeholder="عنوان (اختياري)" onChange={(ev) => up("extra", c.extra.map((x, j) => (j === i ? { ...x, title: ev.target.value } : x)))} style={{ flex: 1 }} />
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => up("extra", c.extra.filter((_, j) => j !== i))}>✕</button></div>
            <textarea rows={3} value={e.body} onChange={(ev) => up("extra", c.extra.map((x, j) => (j === i ? { ...x, body: ev.target.value } : x)))} />
          </div>
        ))}
        <button type="button" className="btn btn-sm btn-light" onClick={() => up("extra", [...c.extra, { title: "", body: "" }])}>+ مادة</button>
      </div>

      <div className="card form f2">
        <div className="field full"><label>المادة الأخيرة</label>{T("closing")}</div>
        <div className="field"><label>اسم الموقّع</label><input type="text" value={c.signerName} onChange={(e) => up("signerName", e.target.value)} /></div>
        <div className="field"><label>الصفة</label><input type="text" value={c.signerTitle} onChange={(e) => up("signerTitle", e.target.value)} /></div>
      </div>

      <div className="row sticky-actions" style={{ position: "sticky", bottom: 0, background: "var(--bg, #fff)", padding: ".6rem 0", gap: ".5rem", flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={go("save")}>💾 حفظ المسودة</button>
        <button className="btn btn-light" onClick={go("regen", "تحديث النتائج والإنذارات والطرد وعقوبات الأندية من بيانات المنظومة؟ ستُستبدل الصفوف المولّدة (تبقى اليدوية).")}>🔄 تحديث من بيانات المنظومة</button>
        <a className="btn btn-light" href={printHref} target="_blank" rel="noreferrer">🖨 معاينة الطباعة (احفظ أولًا)</a>
        <button className="btn btn-gold" onClick={go("issue", "إصدار القرار؟ يُثبَّت برقمه وتاريخه ولا يُعدَّل بعد ذلك.")}>✅ إصدار القرار</button>
      </div>
    </form>
  );
}
