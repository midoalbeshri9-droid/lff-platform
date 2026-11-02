import { notFound } from "next/navigation";
import { and, eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { clubs, charges, payments } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { clubBalance, clubBlockReason } from "@/lib/finance";
import { CHARGE_CATEGORY } from "@/lib/labels";
import { money } from "@/lib/util";
import { PageHead, Flash, Kpi, Field, Options, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { ChargesTable, PaymentsTable } from "@/components/Finance";
import { addManualCharge } from "../../actions";

export default async function ClubAccount({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const u = await requireUser("fin.view");
  const id = Number((await params).id);
  const sp = await searchParams;
  const [c] = await db.select().from(clubs).where(eq(clubs.id, id));
  if (!c) notFound();
  const [bal, block, ch, pays] = await Promise.all([
    clubBalance(id), clubBlockReason(id),
    db.select().from(charges).where(and(eq(charges.clubId, id), eq(charges.direction, "IN"))).orderBy(desc(charges.id)),
    db.select().from(payments).where(eq(payments.clubId, id)).orderBy(desc(payments.id)),
  ]);
  const { REFEREE_FEE: _r, ...cats } = CHARGE_CATEGORY;
  void _r;
  return (
    <>
      <PageHead title={`كشف حساب: ${c.name}`} crumbs={[["حسابات الأندية", "/finance/clubs"], [c.name]]} />
      <Flash sp={sp} />
      {block && <div className="alert warn">⛔ {block}</div>}
      <div className="grid g4">
        <Kpi v={money(bal.total)} l="إجمالي المستحق" color="ink" />
        <Kpi v={money(bal.paid)} l="المدفوع" />
        <Kpi v={money(bal.outstanding)} l="المتبقي" color="red" />
        <Kpi v={money(bal.overdue)} l="متأخر السداد" color="gold" />
      </div>
      <div className="card mt"><h3>المستحقات</h3><ChargesTable rows={ch} canPay={u.can("fin.manage")} canWaive={u.can("fin.approve")} /></div>
      <div className="card"><h3>الإيصالات</h3><PaymentsTable rows={pays} canVoid={u.can("fin.approve")} /></div>
      {u.can("fin.manage") && (
        <details className="box card"><summary>+ مستحق يدوي</summary>
          <form action={addManualCharge} className="form f3 mt">
            <input type="hidden" name="clubId" value={id} />
            <Field label="النوع"><select name="category"><Options map={cats} /></select></Field>
            <Field label="المبلغ"><input type="number" step="0.01" name="amount" required /></Field>
            <Field label="تاريخ الاستحقاق"><input type="date" name="dueDate" /></Field>
            <Field label="البيان" full><input type="text" name="description" required /></Field>
            <div className="full"><Submit>إضافة</Submit></div>
          </form>
        </details>
      )}
    </>
  );
}
