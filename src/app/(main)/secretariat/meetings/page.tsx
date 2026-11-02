import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { meetings, decisions } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { COMMITTEE } from "@/lib/labels";
import { fmtDate, today } from "@/lib/util";
import { PageHead, Flash, Empty, Field, Options, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { saveMeeting } from "../actions";

export default async function Meetings({ searchParams }: { searchParams: SP }) {
  const u = await requireUser("sec.view");
  const sp = await searchParams;
  const rows = await db.select({ m: meetings, n: sql<number>`(select count(*)::int from "decisions" where "decisions"."meeting_id" = "meetings"."id")` })
    .from(meetings).where(sp.body ? eq(meetings.body, sp.body) : undefined).orderBy(desc(meetings.date), desc(meetings.id));
  void decisions;
  return (
    <>
      <PageHead title="محاضر الاجتماعات" sub="محاضر مجلس الإدارة واللجان وما صدر عنها من قرارات" />
      <Flash sp={sp} />
      <form className="filters">
        <div className="field"><label>الجهة</label><select name="body" defaultValue={sp.body ?? ""}><option value="">الكل</option><Options map={COMMITTEE} /></select></div>
        <button className="btn btn-light">عرض</button>
      </form>
      <div className="card table-wrap">
        {rows.length === 0 ? <Empty>لا محاضر</Empty> : (
          <table className="t"><thead><tr><th>الرقم</th><th>الجهة</th><th>التاريخ</th><th>المكان</th><th>القرارات</th><th>الحالة</th><th></th></tr></thead>
            <tbody>{rows.map(({ m, n }) => (
              <tr key={m.id}><td className="kbd">{m.number}</td><td>{COMMITTEE[m.body]}</td><td>{fmtDate(m.date)}</td><td>{m.location}</td><td className="num">{n}</td>
                <td>{m.status === "APPROVED" ? <span className="b b-green">معتمد</span> : <span className="b b-amber">مسودة</span>}</td>
                <td><Link className="btn btn-sm btn-light" href={`/secretariat/meetings/${m.id}`}>فتح</Link></td></tr>
            ))}</tbody></table>
        )}
      </div>
      {u.can("sec.manage") && (
        <details className="card"><summary>+ محضر اجتماع جديد</summary>
          <form action={saveMeeting} className="form f3 mt">
            <Field label="الجهة"><select name="body"><Options map={COMMITTEE} /></select></Field>
            <Field label="التاريخ"><input type="date" name="date" defaultValue={today()} /></Field>
            <Field label="المكان"><input type="text" name="location" /></Field>
            <Field label="الحضور" full><textarea name="attendees" placeholder="اسم في كل سطر" /></Field>
            <Field label="جدول الأعمال" full><textarea name="agenda" /></Field>
            <div className="full"><Submit>إنشاء المحضر</Submit></div>
          </form>
        </details>
      )}
    </>
  );
}
