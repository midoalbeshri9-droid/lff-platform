import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { meetings, decisions, clubs } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { committeeOf } from "@/lib/secretariat";
import { COMMITTEE } from "@/lib/labels";
import { fmtDate } from "@/lib/util";
import { PageHead, Flash, Field, Options, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { saveMeeting, approveMeeting } from "../../actions";
import { DecisionCard, DecisionForm } from "../../decisions/DecisionParts";

export default async function MeetingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const u = await requireUser("sec.view");
  const id = Number((await params).id);
  const sp = await searchParams;
  const [m] = await db.select().from(meetings).where(eq(meetings.id, id));
  if (!m) notFound();
  const ds = await db.select().from(decisions).where(eq(decisions.meetingId, id)).orderBy(asc(decisions.id));
  const cl = await db.select({ id: clubs.id, name: clubs.name }).from(clubs).orderBy(clubs.name);
  const manage = u.can("sec.manage") && m.status !== "APPROVED";
  return (
    <>
      <PageHead title={`محضر ${m.number}`} sub={`${COMMITTEE[m.body]} — ${fmtDate(m.date)}${m.location ? ` — ${m.location}` : ""}`} crumbs={[["المحاضر", "/secretariat/meetings"], [m.number]]}
        actions={<><Link className="btn btn-light" href={`/print/meeting/${m.id}`} target="_blank">🖨 طباعة المحضر</Link>
          {manage && <form action={approveMeeting}><input type="hidden" name="id" value={m.id} /><Submit className="btn btn-primary" confirm="اعتماد المحضر؟ لا يمكن تعديله بعد ذلك.">✓ اعتماد المحضر</Submit></form>}</>} />
      <Flash sp={sp} />
      <div className="grid g2">
        <form action={saveMeeting} className="card form">
          <input type="hidden" name="id" value={m.id} />
          <div className="form f2">
            <Field label="الجهة"><select name="body" defaultValue={m.body} disabled={!manage}><Options map={COMMITTEE} /></select></Field>
            <Field label="التاريخ"><input type="date" name="date" defaultValue={m.date} disabled={!manage} /></Field>
            <Field label="المكان"><input type="text" name="location" defaultValue={m.location ?? ""} disabled={!manage} /></Field>
            <Field label={m.fileKey ? "استبدال الملف الموقع" : "المحضر الموقع (PDF)"}><input type="file" name="file" accept="application/pdf,image/*" disabled={!manage} /></Field>
          </div>
          <Field label="الحضور"><textarea name="attendees" defaultValue={m.attendees ?? ""} disabled={!manage} /></Field>
          <Field label="جدول الأعمال"><textarea name="agenda" defaultValue={m.agenda ?? ""} disabled={!manage} /></Field>
          <Field label="نص المحضر / المداولات"><textarea name="minutes" rows={8} defaultValue={m.minutes ?? ""} disabled={!manage} /></Field>
          {m.fileKey && <a href={`/api/files/${m.fileKey}`} target="_blank">📎 المحضر الموقع</a>}
          {manage && <Submit>حفظ المحضر</Submit>}
        </form>
        <div>
          <h3>القرارات ({ds.length})</h3>
          {ds.map((d) => <DecisionCard key={d.id} d={d} canFollow={u.can("sec.manage") || d.assignee === committeeOf(u.role)} canCancel={u.can("sec.manage")} back={`/secretariat/meetings/${m.id}`} />)}
          {u.can("sec.manage") && <details className="card" open={ds.length === 0}><summary>+ إضافة قرار لهذا المحضر</summary><DecisionForm meetingId={m.id} body={m.body} clubs={cl} /></details>}
        </div>
      </div>
    </>
  );
}
