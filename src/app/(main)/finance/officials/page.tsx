import Link from "next/link";
import { eq, sql, and } from "drizzle-orm";
import { db } from "@/db";
import { officials, charges } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { OFFICIAL_TYPE } from "@/lib/labels";
import { money } from "@/lib/util";
import { PageHead } from "@/components/ui";

export default async function FinOfficials() {
  await requireUser("fin.view");
  const rows = await db.select({
    o: officials,
    total: sql<string>`coalesce(sum(${charges.amount}) filter (where ${charges.status} <> 'CANCELLED'), 0)`,
    paid: sql<string>`coalesce(sum(${charges.paidAmount}), 0)`,
    n: sql<number>`count(${charges.id}) filter (where ${charges.status} in ('OPEN','PARTIAL'))::int`,
  }).from(officials).leftJoin(charges, and(eq(charges.officialId, officials.id), eq(charges.direction, "OUT"))).groupBy(officials.id).orderBy(officials.fullName);
  return (
    <>
      <PageHead title="مستحقات الحكام والمراقبين" sub="تُسجل تلقائيًا عند اعتماد تقرير كل مباراة حسب جدول أجور التحكيم" />
      <div className="card table-wrap">
        <table className="t"><thead><tr><th>الاسم</th><th>النوع</th><th className="num">المستحق</th><th className="num">المصروف</th><th className="num">المتبقي</th><th className="num">مباريات غير مصروفة</th><th></th></tr></thead>
          <tbody>{rows.map(({ o, total, paid, n }) => {
            const rem = Number(total) - Number(paid);
            return <tr key={o.id}><td><strong>{o.fullName}</strong></td><td>{OFFICIAL_TYPE[o.type]}</td><td className="num">{money(total)}</td><td className="num">{money(paid)}</td>
              <td className="num">{rem > 0 ? <strong className="danger-text">{money(rem)}</strong> : "0"}</td><td className="num">{n || "—"}</td>
              <td><Link className="btn btn-sm btn-light" href={`/finance/officials/${o.id}`}>الكشف</Link></td></tr>;
          })}</tbody></table>
      </div>
    </>
  );
}
