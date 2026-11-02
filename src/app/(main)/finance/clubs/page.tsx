import Link from "next/link";
import { eq, sql, inArray, and } from "drizzle-orm";
import { db } from "@/db";
import { clubs, charges } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { money } from "@/lib/util";
import { PageHead } from "@/components/ui";

export default async function FinClubs() {
  await requireUser("fin.view");
  const rows = await db.select({
    id: clubs.id, name: clubs.name,
    total: sql<string>`coalesce(sum(${charges.amount}) filter (where ${charges.status} in ('OPEN','PARTIAL','PAID')), 0)`,
    paid: sql<string>`coalesce(sum(${charges.paidAmount}) filter (where ${charges.status} in ('OPEN','PARTIAL','PAID')), 0)`,
    open: sql<number>`count(${charges.id}) filter (where ${charges.status} in ('OPEN','PARTIAL'))::int`,
  }).from(clubs).leftJoin(charges, and(eq(charges.clubId, clubs.id), eq(charges.direction, "IN"))).groupBy(clubs.id, clubs.name).orderBy(clubs.name);
  void inArray;
  return (
    <>
      <PageHead title="حسابات الأندية" />
      <div className="card table-wrap">
        <table className="t"><thead><tr><th>النادي</th><th className="num">إجمالي المستحق</th><th className="num">المدفوع</th><th className="num">المتبقي</th><th className="num">بنود مفتوحة</th><th></th></tr></thead>
          <tbody>{rows.map((r) => {
            const rem = Number(r.total) - Number(r.paid);
            return <tr key={r.id}><td><strong>{r.name}</strong></td><td className="num">{money(r.total)}</td><td className="num">{money(r.paid)}</td>
              <td className="num">{rem > 0 ? <strong className="danger-text">{money(rem)}</strong> : <span className="ok-text">0</span>}</td><td className="num">{r.open || "—"}</td>
              <td><Link className="btn btn-sm btn-light" href={`/finance/clubs/${r.id}`}>كشف الحساب</Link></td></tr>;
          })}</tbody></table>
      </div>
    </>
  );
}
