import Link from "next/link";
import { and, eq, sql, desc, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { charges, payments, clubs } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { CHARGE_CATEGORY } from "@/lib/labels";
import { money, fmtDate } from "@/lib/util";
import { PageHead, Kpi, Empty } from "@/components/ui";

export default async function FinanceHome() {
  await requireUser("fin.view");
  const monthStart = new Date(); monthStart.setDate(1);
  const ms = monthStart.toISOString().slice(0, 10);
  const open = inArray(charges.status, ["OPEN", "PARTIAL"]);
  const rem = sql<string>`coalesce(sum(${charges.amount} - ${charges.paidAmount}), 0)`;
  const [[recv], [pay], [col], [fines], byCat, debtors, recent] = await Promise.all([
    db.select({ v: rem }).from(charges).where(and(eq(charges.direction, "IN"), open)),
    db.select({ v: rem }).from(charges).where(and(eq(charges.direction, "OUT"), open)),
    db.select({ v: sql<string>`coalesce(sum(${payments.amount}), 0)` }).from(payments).where(and(eq(payments.direction, "IN"), eq(payments.isVoided, false), gte(payments.date, ms))),
    db.select({ v: rem }).from(charges).where(and(eq(charges.category, "FINE"), open)),
    db.select({ cat: charges.category, total: sql<string>`sum(${charges.amount})`, paid: sql<string>`sum(${charges.paidAmount})` }).from(charges)
      .where(and(eq(charges.direction, "IN"), inArray(charges.status, ["OPEN", "PARTIAL", "PAID"]))).groupBy(charges.category),
    db.select({ id: clubs.id, name: clubs.name, v: rem }).from(charges).innerJoin(clubs, eq(clubs.id, charges.clubId))
      .where(and(eq(charges.direction, "IN"), open)).groupBy(clubs.id, clubs.name).orderBy(desc(rem)).limit(8),
    db.select({ p: payments, club: clubs.name }).from(payments).leftJoin(clubs, eq(clubs.id, payments.clubId)).orderBy(desc(payments.id)).limit(8),
  ]);
  return (
    <>
      <PageHead title="اللجنة المالية" sub="المستحقات والتحصيل ومستحقات الحكام — تُسجل تلقائيًا من اللجان" />
      <div className="grid g4">
        <Kpi v={money(recv.v)} l="مستحقات على الأندية (غير محصلة)" color="red" href="/finance/clubs" />
        <Kpi v={money(col.v)} l="المحصل هذا الشهر" href="/finance/payments" />
        <Kpi v={money(fines.v)} l="غرامات غير مسددة" color="gold" />
        <Kpi v={money(pay.v)} l="مستحقات الحكام غير المصروفة" color="ink" href="/finance/officials" />
      </div>
      <div className="grid g2 mt">
        <div className="card table-wrap">
          <h3>أكثر الأندية مديونية</h3>
          {debtors.length === 0 ? <Empty>لا مديونيات</Empty> : (
            <table className="t"><tbody>{debtors.map((d) => <tr key={d.id}><td><Link href={`/finance/clubs/${d.id}`}>{d.name}</Link></td><td className="num danger-text"><strong>{money(d.v)}</strong></td></tr>)}</tbody></table>
          )}
        </div>
        <div className="card table-wrap">
          <h3>الإيرادات حسب النوع</h3>
          <table className="t"><thead><tr><th>النوع</th><th className="num">المستحق</th><th className="num">المحصل</th></tr></thead>
            <tbody>{byCat.map((c) => <tr key={c.cat}><td>{CHARGE_CATEGORY[c.cat] ?? c.cat}</td><td className="num">{money(c.total)}</td><td className="num">{money(c.paid)}</td></tr>)}</tbody></table>
        </div>
      </div>
      <div className="card table-wrap">
        <div className="card-head"><h3>آخر الإيصالات</h3><Link href="/finance/payments">الكل</Link></div>
        <table className="t"><tbody>{recent.map(({ p, club }) => (
          <tr key={p.id}><td className="kbd">{p.receiptNo}</td><td>{fmtDate(p.date)}</td><td>{club ?? "حكم"}</td><td className="num">{money(p.amount)}</td>
            <td>{p.isVoided ? <span className="b b-gray">ملغى</span> : <Link href={`/print/receipt/${p.id}`} target="_blank">🖨</Link>}</td></tr>
        ))}</tbody></table>
      </div>
    </>
  );
}
