"use client";
import { useState } from "react";
import type { ObserverCard, ObserverReport } from "@/db/schema";
import { CRITERIA, EVAL_ROLES, EVAL_TITLE, CREW_LABEL, evalTotal, type EvalRole } from "@/lib/observerForm";

type Team = { id: number; name: string };
type P = { id: number; name: string; cardNo: string; clubId: number; shirt: number | null };
type Crew = Record<EvalRole, { name: string; grade: string } | null>;

/** نموذج تقرير مراقب المباراة المعتمد — تعبئة المراقب في بوابته (يُرسل كحقل data بصيغة JSON) */
export function ObserverReportForm({ initial, home, away, squad, crew, category, reasons, disabled }: {
  initial: ObserverReport; home: Team; away: Team; squad: P[]; crew: Crew; category: string; reasons: string[]; disabled?: boolean;
}) {
  const [d, setD] = useState<ObserverReport>(initial);
  const up = (p: Partial<ObserverReport>) => setD((x) => ({ ...x, ...p }));
  const teams = [home, away];
  const tName = (id: number | null) => teams.find((t) => t.id === id)?.name ?? "";

  const score = (k: "ht" | "ft" | "et" | "pens", label: string) => {
    const [h, a] = d[k];
    const w = h !== "" && a !== "" ? (Number(h) > Number(a) ? home.name : Number(a) > Number(h) ? away.name : "تعادل") : "";
    return (
      <div className="field"><label>{label}</label>
        <div className="row" style={{ gap: ".3rem", flexWrap: "nowrap" }}>
          <span className="muted" style={{ fontSize: ".8rem" }}>{home.name}</span>
          <input className="score-in" type="number" min={0} value={h} disabled={disabled} onChange={(e) => up({ [k]: [e.target.value, a] } as Partial<ObserverReport>)} />
          <span>-</span>
          <input className="score-in" type="number" min={0} value={a} disabled={disabled} onChange={(e) => up({ [k]: [h, e.target.value] } as Partial<ObserverReport>)} />
          <span className="muted" style={{ fontSize: ".8rem" }}>{away.name}</span>
        </div>
        {w && <small className="muted">{w === "تعادل" ? "تعادل" : `لصالح فريق ${w}`}</small>}
      </div>
    );
  };

  const cards = (k: "cautions" | "sendoffs", title: string, color: string, max: number) => {
    const rows = d[k];
    const set = (i: number, p: Partial<ObserverCard>) => up({ [k]: rows.map((r, j) => (j === i ? { ...r, ...p } : r)) } as Partial<ObserverReport>);
    const pick = (i: number, v: string) => {
      if (v === "") return set(i, { playerId: null });
      const p = squad.find((x) => x.id === Number(v));
      if (p) set(i, { playerId: p.id, name: p.name, cardNo: p.cardNo, clubId: p.clubId });
    };
    return (
      <div className="mt">
        <h3 style={{ borderInlineStart: `8px solid ${color}`, paddingInlineStart: ".5rem" }}>{title} <span className="muted" style={{ fontSize: ".8rem" }}>({rows.length})</span></h3>
        <div className="table-wrap"><table className="t no-num">
          <thead><tr><th style={{ width: 28 }}>ت</th><th style={{ minWidth: 220 }}>اسم الرياضي رباعيًا</th><th>بطاقة رياضية</th><th>الفريق</th><th>الفئة</th><th style={{ minWidth: 170 }}>السبب</th><th style={{ width: 70 }}>الوقت</th><th style={{ width: 30 }}></th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>
                <select value={r.playerId ?? ""} disabled={disabled} onChange={(e) => pick(i, e.target.value)} style={{ width: "100%" }}>
                  <option value="">— اختر من القائمة أو اكتب الاسم —</option>
                  {teams.map((t) => <optgroup key={t.id} label={t.name}>{squad.filter((p) => p.clubId === t.id).map((p) => <option key={p.id} value={p.id}>{p.shirt ? `${p.shirt} - ` : ""}{p.name}</option>)}</optgroup>)}
                </select>
                {!r.playerId && <input type="text" value={r.name} placeholder="الاسم يدويًا" disabled={disabled} onChange={(e) => set(i, { name: e.target.value })} style={{ width: "100%", marginTop: 3 }} />}
              </td>
              <td><input type="text" dir="ltr" value={r.cardNo ?? ""} disabled={disabled || !!r.playerId} onChange={(e) => set(i, { cardNo: e.target.value })} style={{ width: 110 }} /></td>
              <td><select value={r.clubId ?? ""} disabled={disabled || !!r.playerId} onChange={(e) => set(i, { clubId: e.target.value ? Number(e.target.value) : null })}><option value="">—</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></td>
              <td>{category}</td>
              <td><input type="text" list="obs-reasons" value={r.reason} disabled={disabled} onChange={(e) => set(i, { reason: e.target.value })} style={{ width: "100%" }} /></td>
              <td><input type="text" inputMode="numeric" value={r.minute} disabled={disabled} onChange={(e) => set(i, { minute: e.target.value })} style={{ width: 60 }} placeholder="د" /></td>
              <td>{!disabled && <button type="button" className="btn btn-sm btn-ghost" onClick={() => up({ [k]: rows.filter((_, j) => j !== i) } as Partial<ObserverReport>)}>✕</button>}</td>
            </tr>))}</tbody>
        </table></div>
        {!disabled && rows.length < max && <button type="button" className="btn btn-sm btn-light mt" onClick={() => up({ [k]: [...rows, { playerId: null, name: "", cardNo: "", clubId: null, category, reason: "", minute: "" }] } as Partial<ObserverReport>)}>+ إضافة</button>}
      </div>
    );
  };

  const scorers = (t: Team) => {
    const rows = d.scorers.map((r, i) => ({ r, i })).filter((x) => x.r.clubId === t.id);
    const set = (i: number, p: Partial<ObserverReport["scorers"][number]>) => up({ scorers: d.scorers.map((r, j) => (j === i ? { ...r, ...p } : r)) });
    return (
      <div>
        <strong>لفريق {t.name}</strong>
        <table className="t no-num"><thead><tr><th style={{ width: 28 }}>ت</th><th style={{ width: 80 }}>فانلة رقم</th><th style={{ width: 70 }}>الأهداف</th><th>الوقت والملاحظات</th><th style={{ width: 30 }}></th></tr></thead>
          <tbody>{rows.map(({ r, i }, n) => (
            <tr key={i}><td>{n + 1}</td>
              <td><input type="text" inputMode="numeric" value={r.shirt} disabled={disabled} onChange={(e) => set(i, { shirt: e.target.value })} style={{ width: 60 }} /></td>
              <td><input type="text" inputMode="numeric" value={r.goals} disabled={disabled} onChange={(e) => set(i, { goals: e.target.value })} style={{ width: 50 }} /></td>
              <td><input type="text" value={r.notes} disabled={disabled} onChange={(e) => set(i, { notes: e.target.value })} style={{ width: "100%" }} placeholder="مثال: د 23، 67 (ركلة جزاء)" /></td>
              <td>{!disabled && <button type="button" className="btn btn-sm btn-ghost" onClick={() => up({ scorers: d.scorers.filter((_, j) => j !== i) })}>✕</button>}</td></tr>))}</tbody></table>
        {!disabled && rows.length < 8 && <button type="button" className="btn btn-sm btn-light" onClick={() => up({ scorers: [...d.scorers, { clubId: t.id, shirt: "", goals: "1", notes: "" }] })}>+ هدّاف</button>}
      </div>
    );
  };

  const evalBox = (role: EvalRole) => {
    const e = d.evals[role] ?? { s: CRITERIA[role].map(() => ""), n: CRITERIA[role].map(() => "") };
    const set = (k: "s" | "n", i: number, v: string) => up({ evals: { ...d.evals, [role]: { ...e, [k]: e[k].map((x, j) => (j === i ? v : x)) } } });
    const tot = evalTotal(role, e.s);
    const who = crew[role];
    return (
      <div className="box mt">
        <h3 style={{ textAlign: "center", textDecoration: "underline" }}>{EVAL_TITLE[role]}{who && <span className="muted" style={{ fontSize: ".85rem", textDecoration: "none" }}> — {who.name}</span>}</h3>
        {CRITERIA[role].map(([label, max], i) => {
          const v = e.s[i] ?? "", bad = v !== "" && (Number(v) < 0 || Number(v) > max);
          return (
            <div key={i} className="row" style={{ alignItems: "flex-start", gap: ".5rem", marginBottom: ".4rem", flexWrap: "nowrap" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: ".9rem" }}>{i + 1}- {label}</div>
                <input type="text" value={e.n[i] ?? ""} disabled={disabled} onChange={(ev) => set("n", i, ev.target.value)} placeholder="ملاحظات" style={{ width: "100%" }} />
              </div>
              <div style={{ textAlign: "center" }}>
                <div className="b b-gray" style={{ display: "block", marginBottom: 2 }}>{max}</div>
                <input type="number" min={0} max={max} step="0.5" value={v} disabled={disabled} onChange={(ev) => set("s", i, ev.target.value)} style={{ width: 64, borderColor: bad ? "#c00" : undefined }} />
              </div>
            </div>
          );
        })}
        <div className="row" style={{ justifyContent: "flex-end", gap: "1rem", fontWeight: 700 }}>
          <span>مجموع الدرجات: {tot ? `${tot.total} من ${CRITERIA[role].reduce((a, [, m]) => a + m, 0)}` : "—"}</span>
          <span>النسبة: {tot ? `${tot.pct}%` : "—"}</span>
          <span>التقدير: {tot ? <span className="b b-indigo">{tot.grade}</span> : "—"}</span>
        </div>
      </div>
    );
  };

  return (
    <>
      <input type="hidden" name="data" value={JSON.stringify(d)} />
      <datalist id="obs-reasons">{reasons.map((r) => <option key={r} value={r} />)}</datalist>
      <h3>النتائج</h3>
      <div className="form f2">
        {score("ht", "نتيجة الشوط الأول")}
        {score("ft", "النتيجة النهائية *")}
        {score("et", "نتيجة الوقت الإضافي (إن وُجد)")}
        {score("pens", "نتيجة الركلات الترجيحية (إن وُجدت)")}
      </div>
      <h3 className="mt">طاقم التحكيم</h3>
      <table className="t"><tbody>{EVAL_ROLES.map((r) => <tr key={r}><td style={{ width: 170 }}>{CREW_LABEL[r]}</td><td><strong>{crew[r]?.name ?? "—"}</strong></td><td className="muted">{crew[r]?.grade ?? ""}</td></tr>)}</tbody></table>
      {cards("cautions", "الإنذارات", "#f2e600", 30)}
      {cards("sendoffs", "الطرد", "#e0245e", 15)}
      <h3 className="mt">مسجلو الأهداف</h3>
      <div className="grid g2">{teams.map((t) => <div key={t.id}>{scorers(t)}</div>)}</div>
      {EVAL_ROLES.filter((r) => crew[r]).map((r) => <div key={r}>{evalBox(r)}</div>)}
      <h3 className="mt">الملاحظات والنصائح المتعلقة بالإدارة ولجنتي المسابقات والتحكيم</h3>
      <textarea className="tall" value={d.adminNotes} disabled={disabled} onChange={(e) => up({ adminNotes: e.target.value })} style={{ width: "100%" }} />
      <h3 className="mt">ملاحظات عامة</h3>
      <textarea className="tall" rows={8} value={d.generalNotes} disabled={disabled} onChange={(e) => up({ generalNotes: e.target.value })} style={{ width: "100%" }} />
    </>
  );
}
