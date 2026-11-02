import { notFound, redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { meetings, decisions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { COMMITTEE } from "@/lib/labels";
import { fmtDate } from "@/lib/util";
import { PrintButton } from "@/components/Client";
import { Letterhead } from "@/components/Letterhead";

export default async function PrintMeeting({ params }: { params: Promise<{ id: string }> }) {
  const u = await getCurrentUser();
  if (!u?.can("sec.view")) redirect("/denied");
  const id = Number((await params).id);
  const [m] = await db.select().from(meetings).where(eq(meetings.id, id));
  if (!m) notFound();
  const ds = await db.select().from(decisions).where(eq(decisions.meetingId, id)).orderBy(asc(decisions.id));
  return (
    <div className="print-root">
      <div className="print-toolbar no-print"><PrintButton /></div>
      <div className="sheet">
        <Letterhead sub={COMMITTEE[m.body]} subEn="Minutes of Meeting" />
        <h1 className="doc-title">محضر اجتماع رقم {m.number}</h1>
        <div className="meta-line"><span>التاريخ: {fmtDate(m.date)}</span>{m.location && <span>المكان: {m.location}</span>}</div>
        {m.attendees && <><h3>الحضور</h3><div className="doc-text">{m.attendees}</div></>}
        {m.agenda && <><h3>جدول الأعمال</h3><div className="doc-text">{m.agenda}</div></>}
        {m.minutes && <><h3>المداولات</h3><div className="doc-text">{m.minutes}</div></>}
        {ds.length > 0 && <>
          <h3>القرارات</h3>
          <table className="roster-table"><thead><tr><th>رقم القرار</th><th>القرار</th><th>الجهة المكلفة</th><th>موعد التنفيذ</th></tr></thead>
            <tbody>{ds.map((d) => <tr key={d.id}><td>{d.number}</td><td className="l"><strong>{d.title}</strong>{d.text && <div>{d.text}</div>}</td><td>{d.assignee ? COMMITTEE[d.assignee] : "—"}</td><td>{fmtDate(d.dueDate)}</td></tr>)}</tbody></table>
        </>}
        <div className="sign-row" style={{ display: "flex", justifyContent: "space-around", marginTop: 50 }}><div>مقرر الاجتماع</div><div>رئيس الاجتماع</div></div>
      </div>
    </div>
  );
}
