import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { correspondence, decisions } from "@/db/schema";
import { requireClubUser } from "@/lib/auth";
import { fmtDate } from "@/lib/util";
import { PageHead, Empty } from "@/components/ui";

export default async function ClubMail() {
  const u = await requireClubUser("club.view");
  const rows = await db.select().from(correspondence).where(and(eq(correspondence.clubId, u.clubId!), eq(correspondence.visibleToClub, true))).orderBy(desc(correspondence.date));
  const ds = await db.select().from(decisions).where(eq(decisions.clubId, u.clubId!)).orderBy(desc(decisions.date));
  return (
    <>
      <PageHead title="مراسلات الاتحاد" sub="الكتب والقرارات الصادرة من الاتحاد إلى ناديكم" />
      <div className="card table-wrap">
        <h3>المراسلات</h3>
        {rows.length === 0 ? <Empty>لا مراسلات</Empty> : (
          <table className="t"><thead><tr><th>الرقم</th><th>التاريخ</th><th>الموضوع</th><th>الملخص</th><th></th></tr></thead>
            <tbody>{rows.map((c) => (
              <tr key={c.id}><td className="kbd">{c.number}</td><td>{fmtDate(c.date)}</td><td><strong>{c.subject}</strong></td><td>{c.summary}</td>
                <td>{c.fileKey && <a className="btn btn-sm btn-light" href={`/api/files/${c.fileKey}`} target="_blank">📎 الكتاب</a>}</td></tr>
            ))}</tbody></table>
        )}
      </div>
      {ds.length > 0 && (
        <div className="card table-wrap">
          <h3>القرارات المتعلقة بالنادي</h3>
          <table className="t"><tbody>{ds.map((d) => <tr key={d.id}><td className="kbd">{d.number}</td><td>{fmtDate(d.date)}</td><td><strong>{d.title}</strong>{d.text && <div className="muted">{d.text}</div>}</td></tr>)}</tbody></table>
        </div>
      )}
    </>
  );
}
