import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { payments, charges, clubs, officials } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { PAY_METHOD, CHARGE_CATEGORY } from "@/lib/labels";
import { fmtDate, money } from "@/lib/util";
import { PrintButton } from "@/components/Client";
import { Letterhead } from "@/components/Letterhead";

export default async function Receipt({ params }: { params: Promise<{ id: string }> }) {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  const id = Number((await params).id);
  const [r] = await db.select({ p: payments, c: charges, club: clubs.name, off: officials.fullName }).from(payments)
    .innerJoin(charges, eq(charges.id, payments.chargeId)).leftJoin(clubs, eq(clubs.id, payments.clubId)).leftJoin(officials, eq(officials.id, payments.officialId))
    .where(eq(payments.id, id));
  if (!r) notFound();
  if (!(u.can("fin.view") || (u.isClub && u.clubId === r.p.clubId && u.can("club.finance")))) redirect("/denied");
  const inbound = r.p.direction === "IN";
  return (
    <div className="print-root">
      <div className="print-toolbar no-print"><PrintButton /></div>
      <div className="sheet" style={{ minHeight: "auto" }}>
        <Letterhead sub="اللجنة المالية" subEn="Finance Committee" />
        <h1 className="doc-title">{inbound ? "إيصال استلام" : "سند صرف"}{r.p.isVoided ? " (ملغى)" : ""}</h1>
        <div className="meta-line"><span>الرقم: <strong>{r.p.receiptNo}</strong></span><span>التاريخ: {fmtDate(r.p.date)}</span></div>
        <table className="roster-table" style={{ fontSize: "1rem" }}><tbody>
          <tr><th style={{ width: "28%" }}>{inbound ? "استلمنا من" : "صُرف إلى"}</th><td className="l">{r.club ?? r.off}</td></tr>
          <tr><th>مبلغًا وقدره</th><td className="l"><strong>{money(r.p.amount)}</strong></td></tr>
          <tr><th>وذلك عن</th><td className="l">{CHARGE_CATEGORY[r.c.category] ?? r.c.category} — {r.c.description}</td></tr>
          <tr><th>طريقة الدفع</th><td className="l">{PAY_METHOD[r.p.method]}{r.p.reference ? ` — مرجع: ${r.p.reference}` : ""}</td></tr>
          <tr><th>المتبقي من البند</th><td className="l">{money(Math.max(0, Number(r.c.amount) - Number(r.c.paidAmount)))}</td></tr>
          {r.p.notes && <tr><th>ملاحظات</th><td className="l">{r.p.notes}</td></tr>}
        </tbody></table>
        <div className="signatures"><div className="sig">{inbound ? "المستلم" : "المستلِم (الحكم)"}<br /><small>{inbound ? r.p.receivedBy : ""}</small></div><div className="sig stamp-box"><img src="/img/stamp.png" alt="" />رئيس اللجنة المالية</div></div>
      </div>
    </div>
  );
}
