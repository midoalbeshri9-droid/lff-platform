import { and, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { payments, clubs, officials } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { PAY_METHOD } from "@/lib/labels";
import { money, fmtDate } from "@/lib/util";
import { PageHead, Empty, type SP } from "@/components/ui";
import Link from "next/link";

export default async function Payments({ searchParams }: { searchParams: SP }) {
  await requireUser("fin.view");
  const sp = await searchParams;
  const rows = await db.select({ p: payments, club: clubs.name, off: officials.fullName }).from(payments)
    .leftJoin(clubs, eq(clubs.id, payments.clubId)).leftJoin(officials, eq(officials.id, payments.officialId))
    .where(and(sp.dir ? eq(payments.direction, sp.dir as "IN") : undefined, sp.from ? gte(payments.date, sp.from) : undefined, sp.to ? lte(payments.date, sp.to) : undefined))
    .orderBy(desc(payments.id)).limit(500);
  const total = rows.filter((r) => !r.p.isVoided).reduce((s, r) => s + Number(r.p.amount) * (r.p.direction === "IN" ? 1 : -1), 0);
  return (
    <>
      <PageHead title="الإيصالات وسندات الصرف" sub={`الصافي للفترة: ${money(total)}`} actions={<a className="btn btn-light" href={`/api/export/payments?${new URLSearchParams(sp as Record<string, string>).toString()}`}>⬇ Excel</a>} />
      <form className="filters">
        <div className="field"><label>النوع</label><select name="dir" defaultValue={sp.dir ?? ""}><option value="">الكل</option><option value="IN">إيصالات استلام</option><option value="OUT">سندات صرف</option></select></div>
        <div className="field"><label>من</label><input type="date" name="from" defaultValue={sp.from} /></div>
        <div className="field"><label>إلى</label><input type="date" name="to" defaultValue={sp.to} /></div>
        <button className="btn btn-light">عرض</button>
      </form>
      <div className="card table-wrap">
        {rows.length === 0 ? <Empty>لا توجد</Empty> : (
          <table className="t"><thead><tr><th>الرقم</th><th>التاريخ</th><th>الجهة</th><th>النوع</th><th className="num">المبلغ</th><th>الطريقة</th><th>بواسطة</th><th></th></tr></thead>
            <tbody>{rows.map(({ p, club, off }) => (
              <tr key={p.id} className={p.isVoided ? "danger" : ""}><td className="kbd">{p.receiptNo}</td><td>{fmtDate(p.date)}</td><td>{club ?? off}</td>
                <td>{p.direction === "IN" ? "استلام" : "صرف"}</td><td className="num">{money(p.amount)}</td><td>{PAY_METHOD[p.method]}</td><td>{p.receivedBy}</td>
                <td>{p.isVoided ? <span className="b b-gray">ملغى</span> : <Link href={`/print/receipt/${p.id}`} target="_blank">🖨</Link>}</td></tr>
            ))}</tbody></table>
        )}
      </div>
    </>
  );
}
