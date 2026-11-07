import { Fragment } from "react";
import type { ReportField } from "@/db/schema";

/** خانات نموذج التقرير (تُرسل كـ f_<id>) — للتعبئة في بوابة الحكم/المراقب */
export function ReportFields({ fields, answers, disabled }: { fields: ReportField[]; answers: Record<string, string>; disabled?: boolean }) {
  return (
    <div className="form f2">
      {fields.map((x) => {
        if (x.type === "section") return <h3 key={x.id} className="full" style={{ margin: ".8rem 0 0", borderBottom: "1px solid var(--line, #ddd)", paddingBottom: ".2rem" }}>{x.label}</h3>;
        const name = `f_${x.id}`, v = answers[x.id] ?? "";
        const label = <label>{x.label}{x.required && <span className="danger-text"> *</span>}</label>;
        const help = x.help ? <small className="muted">{x.help}</small> : null;
        const wide = x.type === "textarea";
        let input;
        switch (x.type) {
          case "textarea": input = <textarea name={name} defaultValue={v} disabled={disabled} className="tall" />; break;
          case "number": input = <input type="number" name={name} defaultValue={v} disabled={disabled} step="any" />; break;
          case "time": input = <input type="time" name={name} defaultValue={v} disabled={disabled} />; break;
          case "date": input = <input type="date" name={name} defaultValue={v} disabled={disabled} />; break;
          case "yesno": input = <select name={name} defaultValue={v} disabled={disabled}><option value="">—</option><option value="نعم">نعم</option><option value="لا">لا</option></select>; break;
          case "select": input = <select name={name} defaultValue={v} disabled={disabled}><option value="">—</option>{x.options?.map((o) => <option key={o} value={o}>{o}</option>)}</select>; break;
          case "rating": input = <select name={name} defaultValue={v} disabled={disabled}><option value="">—</option>{Array.from({ length: 10 }, (_, i) => String(i + 1)).map((o) => <option key={o} value={o}>{o} / 10</option>)}</select>; break;
          default: input = <input type="text" name={name} defaultValue={v} disabled={disabled} />;
        }
        return <div key={x.id} className={`field${wide ? " full" : ""}`}>{label}{input}{help}</div>;
      })}
    </div>
  );
}

/** عرض التقرير المعبأ (للجنة المسابقات) */
export function ReportAnswers({ fields, answers }: { fields: ReportField[]; answers: Record<string, string> }) {
  return (
    <dl className="dl">
      {fields.map((x) => x.type === "section"
        ? <h4 key={x.id} style={{ gridColumn: "1 / -1", margin: ".6rem 0 .1rem" }}>{x.label}</h4>
        : <Fragment key={x.id}><dt>{x.label}</dt><dd style={{ whiteSpace: "pre-wrap" }}>{answers[x.id] ? (x.type === "rating" ? `${answers[x.id]} / 10` : answers[x.id]) : <span className="muted">—</span>}</dd></Fragment>)}
    </dl>
  );
}
