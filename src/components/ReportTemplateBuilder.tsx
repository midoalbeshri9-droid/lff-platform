"use client";
import { useState } from "react";
import type { ReportField } from "@/db/schema";
import { ReportFields } from "./ReportFields";

const TYPES: [ReportField["type"], string][] = [
  ["section", "— عنوان قسم —"], ["text", "نص قصير"], ["textarea", "نص طويل"], ["number", "رقم"], ["yesno", "نعم / لا"],
  ["select", "اختيار من قائمة"], ["rating", "تقييم من 10"], ["time", "وقت"], ["date", "تاريخ"],
];
type Row = ReportField & { k: number; opts?: string };
let seq = 0;
const toRow = (f: ReportField): Row => ({ ...f, k: ++seq, opts: f.options?.join("\n") });

/** مصمم نموذج تقرير الحكم / المراقب — لجنة المسابقات */
export function ReportTemplateBuilder({ kind, title, fields, requireAttachment, action }: { kind: string; title: string; fields: ReportField[]; requireAttachment: boolean; action: (f: FormData) => Promise<void> }) {
  const [rows, setRows] = useState<Row[]>(() => fields.map(toRow));
  const [preview, setPreview] = useState(false);
  const set = (k: number, p: Partial<Row>) => setRows((r) => r.map((x) => (x.k === k ? { ...x, ...p } : x)));
  const move = (i: number, d: number) => setRows((r) => { const n = [...r]; const j = i + d; if (j < 0 || j >= n.length) return r; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const add = (type: ReportField["type"]) => setRows((r) => [...r, { k: ++seq, id: `f${Date.now().toString(36)}${seq}`, type, label: "" }]);
  const out: ReportField[] = rows.filter((x) => x.label.trim()).map(({ k: _k, opts, ...x }) => ({ ...x, label: x.label.trim(), ...(x.type === "select" ? { options: (opts ?? "").split(/\n|,|،/).map((o) => o.trim()).filter(Boolean) } : { options: undefined }) }));
  return (
    <form action={action} className="stack">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="fields" value={JSON.stringify(out)} />
      <div className="card form f2">
        <div className="field"><label>عنوان النموذج *</label><input type="text" name="title" defaultValue={title} required /></div>
        <label className="check" style={{ alignSelf: "end" }}><input type="checkbox" name="requireAttachment" value="1" defaultChecked={requireAttachment} /> إلزام إرفاق التقرير الورقي الموقّع (صورة أو PDF) قبل الإرسال</label>
      </div>
      <div className="row"><button type="button" className={`btn btn-sm ${preview ? "btn-light" : "btn-primary"}`} onClick={() => setPreview(false)}>✏ تصميم</button>
        <button type="button" className={`btn btn-sm ${preview ? "btn-primary" : "btn-light"}`} onClick={() => setPreview(true)}>👁 معاينة كما يراها {kind === "REFEREE" ? "الحكم" : "المراقب"}</button></div>
      {preview ? <div className="card"><ReportFields fields={out} answers={{}} /></div> : (
        <div className="card table-wrap">
          <table className="t"><thead><tr><th style={{ width: 70 }}></th><th style={{ width: 170 }}>النوع</th><th>نص الخانة</th><th style={{ width: 230 }}>الخيارات / الشرح</th><th style={{ width: 70 }}>إلزامي</th><th style={{ width: 40 }}></th></tr></thead>
            <tbody>{rows.map((x, i) => (
              <tr key={x.k} style={x.type === "section" ? { background: "var(--bg-soft, #f5f5f0)" } : undefined}>
                <td style={{ whiteSpace: "nowrap" }}><button type="button" className="btn btn-sm btn-ghost" onClick={() => move(i, -1)} disabled={i === 0} title="أعلى">▲</button><button type="button" className="btn btn-sm btn-ghost" onClick={() => move(i, 1)} disabled={i === rows.length - 1} title="أسفل">▼</button></td>
                <td><select value={x.type} onChange={(e) => set(x.k, { type: e.target.value as ReportField["type"] })}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>
                <td><input type="text" value={x.label} onChange={(e) => set(x.k, { label: e.target.value })} placeholder={x.type === "section" ? "عنوان القسم" : "نص السؤال / الخانة"} style={{ width: "100%", fontWeight: x.type === "section" ? 700 : undefined }} /></td>
                <td>{x.type === "select" ? <textarea rows={2} value={x.opts ?? ""} onChange={(e) => set(x.k, { opts: e.target.value })} placeholder="خيار في كل سطر" />
                  : x.type !== "section" ? <input type="text" value={x.help ?? ""} onChange={(e) => set(x.k, { help: e.target.value })} placeholder="شرح اختياري" /> : null}</td>
                <td style={{ textAlign: "center" }}>{x.type !== "section" && <input type="checkbox" checked={!!x.required} onChange={(e) => set(x.k, { required: e.target.checked })} />}</td>
                <td><button type="button" className="btn btn-sm btn-ghost" onClick={() => setRows((r) => r.filter((y) => y.k !== x.k))} title="حذف">✕</button></td>
              </tr>))}</tbody></table>
          <div className="row mt" style={{ flexWrap: "wrap", gap: ".4rem" }}>
            <span className="muted">إضافة:</span>
            {TYPES.map(([v, l]) => <button key={v} type="button" className="btn btn-sm btn-light" onClick={() => add(v)}>+ {l}</button>)}
          </div>
        </div>
      )}
      <div className="row"><button className="btn btn-gold">💾 حفظ النموذج</button><span className="muted" style={{ fontSize: ".85rem" }}>{out.filter((x) => x.type !== "section").length} خانة — التقارير المرسلة سابقًا تحتفظ بنموذجها الأصلي</span></div>
    </form>
  );
}
