import Link from "next/link";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { correspondence, clubs } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { COMMITTEE, CORR_STATUS } from "@/lib/labels";
import { fmtDate, today } from "@/lib/util";
import { PageHead, Flash, Empty, Badge, Options, type SP } from "@/components/ui";
import { CorrForm } from "./form";

export default async function Mail({ searchParams }: { searchParams: SP }) {
  const u = await requireUser("sec.view");
  const sp = await searchParams;
  const q = sp.q?.trim();
  const rows = await db.select({ c: correspondence, club: clubs.name }).from(correspondence).leftJoin(clubs, eq(clubs.id, correspondence.clubId))
    .where(and(
      sp.dir ? eq(correspondence.direction, sp.dir) : undefined, sp.status ? eq(correspondence.status, sp.status) : undefined,
      sp.club ? eq(correspondence.clubId, Number(sp.club)) : undefined, sp.committee ? eq(correspondence.committee, sp.committee) : undefined,
      sp.year ? sql`extract(year from ${correspondence.date}) = ${Number(sp.year)}` : undefined,
      q ? or(ilike(correspondence.subject, `%${q}%`), ilike(correspondence.number, `%${q}%`), ilike(correspondence.party, `%${q}%`), ilike(correspondence.refNumber, `%${q}%`)) : undefined,
    )).orderBy(desc(correspondence.date), desc(correspondence.id)).limit(500);
  const cl = await db.select({ id: clubs.id, name: clubs.name }).from(clubs).orderBy(clubs.name);
  const t = today();
  const overdue = rows.filter((r) => r.c.status === "OPEN" && r.c.dueDate && r.c.dueDate < t).length;
  return (
    <>
      <PageHead title="الصادر والوارد" sub="ترقيم المراسلات الرسمية وأرشفتها وربطها بالأندية واللاعبين والمباريات" />
      <Flash sp={sp} />
      {overdue > 0 && <div className="alert warn">⏰ {overdue} مراسلة واردة تجاوزت موعد الرد</div>}
      <form className="filters">
        <div className="field"><label>بحث</label><input type="text" name="q" defaultValue={q ?? ""} placeholder="الرقم، الموضوع، الجهة" /></div>
        <div className="field"><label>النوع</label><select name="dir" defaultValue={sp.dir ?? ""}><option value="">الكل</option><option value="IN">وارد</option><option value="OUT">صادر</option></select></div>
        <div className="field"><label>الحالة</label><select name="status" defaultValue={sp.status ?? ""}><option value="">الكل</option>{Object.entries(CORR_STATUS).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</select></div>
        <div className="field"><label>اللجنة</label><select name="committee" defaultValue={sp.committee ?? ""}><option value="">الكل</option><Options map={COMMITTEE} /></select></div>
        <div className="field"><label>النادي</label><select name="club" defaultValue={sp.club ?? ""}><option value="">الكل</option>{cl.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field"><label>السنة</label><input type="number" name="year" defaultValue={sp.year ?? ""} style={{ width: 90 }} /></div>
        <button className="btn btn-light">عرض</button>
      </form>
      <div className="card table-wrap">
        {rows.length === 0 ? <Empty>لا مراسلات</Empty> : (
          <table className="t"><thead><tr><th>الرقم</th><th>التاريخ</th><th>النوع</th><th>الموضوع</th><th>من / إلى</th><th>اللجنة</th><th>النادي</th><th>الحالة</th><th></th></tr></thead>
            <tbody>{rows.map(({ c, club }) => (
              <tr key={c.id} className={c.status === "OPEN" && c.dueDate && c.dueDate < t ? "danger" : ""}>
                <td className="kbd nowrap">{c.number}</td><td className="nowrap">{fmtDate(c.date)}</td>
                <td><span className={`b ${c.direction === "IN" ? "b-blue" : "b-gray"}`}>{c.direction === "IN" ? "وارد" : "صادر"}</span></td>
                <td><strong>{c.subject}</strong>{c.fileKey && " 📎"}</td><td>{c.party}</td><td>{c.committee ? COMMITTEE[c.committee] : ""}</td><td>{club}</td>
                <td><Badge v={CORR_STATUS[c.status]} /></td><td><Link className="btn btn-sm btn-light" href={`/secretariat/mail/${c.id}`}>فتح</Link></td>
              </tr>
            ))}</tbody></table>
        )}
      </div>
      {u.can("sec.manage") && (
        <details className="card" open={rows.length === 0}>
          <summary>+ تسجيل مراسلة</summary>
          <CorrForm clubs={cl} />
        </details>
      )}
    </>
  );
}
