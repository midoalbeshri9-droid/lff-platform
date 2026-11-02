import { and, eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { charges, payments } from "@/db/schema";
import { requireClubUser } from "@/lib/auth";
import { clubBalance, clubBlockReason } from "@/lib/finance";
import { money } from "@/lib/util";
import { PageHead, Kpi } from "@/components/ui";
import { ChargesTable, PaymentsTable } from "@/components/Finance";

export default async function ClubFinance() {
  const u = await requireClubUser("club.finance");
  const [bal, block, ch, pays] = await Promise.all([
    clubBalance(u.clubId), clubBlockReason(u.clubId),
    db.select().from(charges).where(and(eq(charges.clubId, u.clubId), eq(charges.direction, "IN"))).orderBy(desc(charges.id)),
    db.select().from(payments).where(and(eq(payments.clubId, u.clubId), eq(payments.isVoided, false))).orderBy(desc(payments.id)),
  ]);
  return (
    <>
      <PageHead title="الحساب المالي" sub="الرسوم والغرامات المستحقة على النادي وإيصالات السداد — السداد لدى اللجنة المالية بالاتحاد" />
      {block && <div className="alert err">⛔ {block}</div>}
      <div className="grid g4">
        <Kpi v={money(bal.total)} l="إجمالي المستحق" color="ink" />
        <Kpi v={money(bal.paid)} l="المدفوع" />
        <Kpi v={money(bal.outstanding)} l="المتبقي" color="red" />
        <Kpi v={money(bal.overdue)} l="متأخر السداد" color="gold" />
      </div>
      <div className="card mt"><h3>المستحقات</h3><ChargesTable rows={ch} /></div>
      <div className="card"><h3>إيصالات السداد</h3><PaymentsTable rows={pays} /></div>
    </>
  );
}
