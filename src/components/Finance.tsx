import Link from "next/link";
import type { charges, payments } from "@/db/schema";
import { CHARGE_CATEGORY, CHARGE_STATUS, PAY_METHOD } from "@/lib/labels";
import { fmtDate, money, today } from "@/lib/util";
import { fileUrl } from "@/lib/storage";
import { Badge, Empty, Options } from "./ui";
import { Submit } from "./Client";
import { recordPayment, waiveCharge, voidPayment } from "@/app/(main)/finance/actions";

type C = typeof charges.$inferSelect;
type P = typeof payments.$inferSelect;

export function ChargesTable({ rows, canPay, canWaive }: { rows: C[]; canPay?: boolean; canWaive?: boolean }) {
  if (!rows.length) return <Empty>لا توجد مستحقات</Empty>;
  return (
    <div className="table-wrap">
      <table className="t">
        <thead><tr><th>التاريخ</th><th>النوع</th><th>البيان</th><th className="num">المبلغ</th><th className="num">المدفوع</th><th className="num">المتبقي</th><th>الحالة</th>{(canPay || canWaive) && <th></th>}</tr></thead>
        <tbody>{rows.map((c) => {
          const rem = Number(c.amount) - Number(c.paidAmount);
          const open = ["OPEN", "PARTIAL"].includes(c.status);
          return (
            <tr key={c.id} className={open && rem > 0 ? "" : ""}>
              <td className="nowrap">{fmtDate(c.createdAt)}</td><td>{CHARGE_CATEGORY[c.category] ?? c.category}</td>
              <td>{c.description}{c.waiveReason && <div className="muted" style={{ fontSize: ".78rem" }}>إعفاء: {c.waiveReason}</div>}</td>
              <td className="num">{money(c.amount)}</td><td className="num">{money(c.paidAmount)}</td>
              <td className="num">{open ? <strong className={rem > 0 ? "danger-text" : ""}>{money(rem)}</strong> : "—"}</td>
              <td><Badge v={CHARGE_STATUS[c.status]} /></td>
              {(canPay || canWaive) && (
                <td>{open && (
                  <details><summary className="btn btn-sm btn-light">{c.direction === "IN" ? "تسجيل دفعة" : "صرف"}</summary>
                    <div style={{ minWidth: 300 }}>
                      {canPay && (
                        <form action={recordPayment} className="stack mt">
                          <input type="hidden" name="chargeId" value={c.id} />
                          <input type="number" step="0.01" name="amount" defaultValue={rem.toFixed(2)} max={rem} required />
                          <select name="method"><Options map={PAY_METHOD} /></select>
                          <input type="text" name="reference" placeholder="رقم الصك / الحوالة" />
                          <input type="date" name="date" defaultValue={today()} />
                          <label style={{ fontSize: ".8rem" }}>صورة الإيصال/الحوالة<input type="file" name="attachment" accept="application/pdf,image/*" /></label>
                          <Submit>💾 تسجيل وإصدار إيصال</Submit>
                        </form>
                      )}
                      {canWaive && (
                        <form action={waiveCharge} className="stack mt">
                          <input type="hidden" name="chargeId" value={c.id} />
                          <input type="text" name="reason" placeholder="سبب الإعفاء (قرار رقم...)" required />
                          <Submit className="btn btn-sm btn-ghost" confirm="الإعفاء من المتبقي؟">إعفاء من المتبقي</Submit>
                        </form>
                      )}
                    </div>
                  </details>
                )}</td>
              )}
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

export function PaymentsTable({ rows, canVoid }: { rows: P[]; canVoid?: boolean }) {
  if (!rows.length) return <Empty>لا توجد دفعات</Empty>;
  return (
    <div className="table-wrap">
      <table className="t">
        <thead><tr><th>رقم الإيصال</th><th>التاريخ</th><th className="num">المبلغ</th><th>الطريقة</th><th>المرجع</th><th>بواسطة</th><th></th></tr></thead>
        <tbody>{rows.map((p) => (
          <tr key={p.id} className={p.isVoided ? "danger" : ""}>
            <td className="kbd">{p.receiptNo}</td><td>{fmtDate(p.date)}</td><td className="num"><strong>{money(p.amount)}</strong></td>
            <td>{PAY_METHOD[p.method] ?? p.method}</td><td>{p.reference ?? "—"}{p.attachmentKey && <> <a href={fileUrl(p.attachmentKey)!} target="_blank">📎</a></>}</td>
            <td>{p.receivedBy}</td>
            <td className="btn-row">
              {p.isVoided ? <span className="b b-gray">ملغى</span> : <Link className="btn btn-sm btn-light" href={`/print/receipt/${p.id}`} target="_blank">🖨 الإيصال</Link>}
              {canVoid && !p.isVoided && (
                <details><summary className="btn btn-sm btn-ghost">إلغاء</summary>
                  <form action={voidPayment} className="stack"><input type="hidden" name="paymentId" value={p.id} /><input type="text" name="reason" placeholder="السبب" required /><Submit className="btn btn-sm btn-danger" confirm="إلغاء الإيصال؟">تأكيد</Submit></form>
                </details>
              )}
            </td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
