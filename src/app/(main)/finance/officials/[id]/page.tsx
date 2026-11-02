import { notFound } from "next/navigation";
import { and, eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { officials, charges, payments } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { OFFICIAL_TYPE, PAY_METHOD, CHARGE_STATUS } from "@/lib/labels";
import { money, fmtDate, today } from "@/lib/util";
import { PageHead, Flash, Badge, Options, type SP } from "@/components/ui";
import { Submit, CheckAll } from "@/components/Client";
import { PaymentsTable } from "@/components/Finance";
import { payOfficialBulk } from "../../actions";

export default async function OfficialAccount({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const u = await requireUser("fin.view");
  const id = Number((await params).id);
  const sp = await searchParams;
  const [o] = await db.select().from(officials).where(eq(officials.id, id));
  if (!o) notFound();
  const ch = await db.select().from(charges).where(and(eq(charges.officialId, id), eq(charges.direction, "OUT"))).orderBy(desc(charges.id));
  const pays = await db.select().from(payments).where(eq(payments.officialId, id)).orderBy(desc(payments.id));
  const open = ch.filter((c) => ["OPEN", "PARTIAL"].includes(c.status));
  const due = open.reduce((s, c) => s + Number(c.amount) - Number(c.paidAmount), 0);
  return (
    <>
      <PageHead title={`مستحقات: ${o.fullName}`} sub={`${OFFICIAL_TYPE[o.type]} — المتبقي ${money(due)}`} crumbs={[["مستحقات الحكام", "/finance/officials"], [o.fullName]]} />
      <Flash sp={sp} />
      <form action={payOfficialBulk} className="card">
        <input type="hidden" name="officialId" value={id} />
        <div className="table-wrap">
          <table className="t"><thead><tr><th>{u.can("fin.manage") && <CheckAll name="charge" label="" />}</th><th>التاريخ</th><th>المباراة</th><th className="num">المبلغ</th><th className="num">المصروف</th><th>الحالة</th></tr></thead>
            <tbody>{ch.map((c) => (
              <tr key={c.id}><td>{["OPEN", "PARTIAL"].includes(c.status) && u.can("fin.manage") && <input type="checkbox" name="charge" value={c.id} />}</td>
                <td>{fmtDate(c.createdAt)}</td><td>{c.description}</td><td className="num">{money(c.amount)}</td><td className="num">{money(c.paidAmount)}</td><td><Badge v={CHARGE_STATUS[c.status]} /></td></tr>
            ))}</tbody></table>
        </div>
        {u.can("fin.manage") && open.length > 0 && (
          <div className="row mt">
            <select name="method" style={{ width: "auto" }}><Options map={PAY_METHOD} /></select>
            <input type="text" name="reference" placeholder="المرجع" style={{ width: 160 }} />
            <input type="date" name="date" defaultValue={today()} style={{ width: 160 }} />
            <Submit confirm="صرف المستحقات المحددة؟">💵 صرف المحدد</Submit>
          </div>
        )}
      </form>
      <div className="card"><h3>سندات الصرف</h3><PaymentsTable rows={pays} canVoid={u.can("fin.approve")} /></div>
    </>
  );
}
