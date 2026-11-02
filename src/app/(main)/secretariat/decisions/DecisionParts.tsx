import { Field, Options, Badge } from "@/components/ui";
import { Submit } from "@/components/Client";
import { COMMITTEE, DECISION_STATUS } from "@/lib/labels";
import { fmtDate, today } from "@/lib/util";
import { saveDecision, followUpDecision } from "../actions";
import type { decisions } from "@/db/schema";

type D = typeof decisions.$inferSelect;

export function DecisionForm({ meetingId, body, clubs }: { meetingId?: number; body?: string; clubs: { id: number; name: string }[] }) {
  return (
    <form action={saveDecision} className="form f3 mt">
      {meetingId && <input type="hidden" name="meetingId" value={meetingId} />}
      <Field label="الجهة المصدرة"><select name="body" defaultValue={body ?? "BOARD"}><Options map={COMMITTEE} /></select></Field>
      <Field label="التاريخ"><input type="date" name="date" defaultValue={today()} /></Field>
      <Field label="الجهة المكلفة بالتنفيذ"><select name="assignee"><option value="">—</option><Options map={COMMITTEE} /></select></Field>
      <Field label="عنوان القرار *" full><input type="text" name="title" required /></Field>
      <Field label="نص القرار" full><textarea name="text" /></Field>
      <Field label="موعد التنفيذ"><input type="date" name="dueDate" /></Field>
      <Field label="النادي المعني"><select name="clubId"><option value="">—</option>{clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="مرفق"><input type="file" name="file" accept="application/pdf,image/*" /></Field>
      <div className="full"><Submit>تسجيل القرار وإبلاغ الجهة المكلفة</Submit></div>
    </form>
  );
}

export function DecisionCard({ d, canFollow, canCancel, back }: { d: D; canFollow: boolean; canCancel: boolean; back: string }) {
  const late = d.dueDate && d.dueDate < today() && !["DONE", "CANCELLED"].includes(d.status);
  return (
    <div className={`card ${late ? "late-card" : ""}`}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div><span className="kbd">{d.number}</span> <strong>{d.title}</strong></div>
        <div className="row"><Badge v={DECISION_STATUS[d.status]} />{late && <span className="b b-red">متأخر</span>}</div>
      </div>
      <div className="muted" style={{ fontSize: ".85rem" }}>
        {COMMITTEE[d.body]} — {fmtDate(d.date)}{d.assignee && <> — التنفيذ: <strong>{COMMITTEE[d.assignee]}</strong></>}{d.dueDate && <> — قبل {fmtDate(d.dueDate)}</>}
      </div>
      {d.text && <div className="doc-text mt">{d.text}</div>}
      {d.fileKey && <a href={`/api/files/${d.fileKey}`} target="_blank">📎 المرفق</a>}
      {d.followUp && <details className="mt"><summary>سجل المتابعة</summary><div className="doc-text">{d.followUp}</div></details>}
      {canFollow && !["DONE", "CANCELLED"].includes(d.status) && (
        <form action={followUpDecision} className="row mt">
          <input type="hidden" name="id" value={d.id} /><input type="hidden" name="back" value={back} />
          <select name="status" defaultValue={d.status} style={{ width: "auto" }}>
            {Object.entries(DECISION_STATUS).filter(([k]) => canCancel || k !== "CANCELLED").map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}
          </select>
          <input type="text" name="note" placeholder="ملاحظة المتابعة" style={{ flex: 1 }} />
          <Submit className="btn btn-sm btn-light">تحديث</Submit>
        </form>
      )}
    </div>
  );
}
