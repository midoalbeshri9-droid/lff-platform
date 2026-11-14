"use server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { charges, payments, walletTx } from "@/db/schema";
import { requireUser, requireClubUser } from "@/lib/auth";
import { audit, notifyClub } from "@/lib/audit";
import { nextReceiptNo, walletBalance } from "@/lib/finance";
import { attempt, str, req, int, num, UserError, today } from "@/lib/util";

/** شحن محفظة النادي بعد استلام النقد (MA Finance Admin) */
export async function walletTopUp(f: FormData) {
  const u = await requireUser("fin.manage");
  const clubId = int(f, "clubId")!;
  await attempt(`/finance/clubs/${clubId}`, async () => {
    const amount = Number(num(f, "amount"));
    if (!(amount > 0)) throw new UserError("أدخل مبلغ الشحن");
    let receiptNo = "";
    await db.transaction(async (tx) => {
      receiptNo = await nextReceiptNo(tx, "W");
      await tx.insert(walletTx).values({ clubId, amount: amount.toFixed(2), kind: "TOPUP", receiptNo, method: req(f, "method", "طريقة الدفع"), reference: str(f, "reference"), notes: str(f, "notes"), createdBy: u.fullName });
    });
    await notifyClub(clubId, `شُحنت محفظة النادي ${receiptNo}`, `${amount.toFixed(2)} د.ل`, "/club/finance");
    await audit(u, "شحن محفظة نادٍ", "Club", clubId, { receiptNo, amount });
    return `تم شحن المحفظة — إيصال ${receiptNo}`;
  });
}

/** الدفع من المحفظة لمستحق على النادي (يسجّل دفعة بطريقة «محفظة» ويخصم الرصيد) */
async function payFromWallet(chargeId: number, clubId: number, by: string) {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(charges).where(eq(charges.id, chargeId)).for("update");
    if (!c || c.clubId !== clubId || c.direction !== "IN") throw new UserError("المستحق غير موجود");
    if (["PAID", "WAIVED", "CANCELLED"].includes(c.status)) throw new UserError("المستحق مدفوع أو ملغى");
    const remaining = Number(c.amount) - Number(c.paidAmount);
    const bal = await walletBalance(clubId, tx);
    const amount = Math.min(remaining, bal);
    if (!(amount > 0.001)) throw new UserError("رصيد المحفظة لا يكفي — اطلب من الاتحاد شحنها");
    const receiptNo = await nextReceiptNo(tx, "R");
    await tx.insert(payments).values({ receiptNo, direction: "IN", chargeId, clubId, amount: amount.toFixed(2), method: "WALLET", reference: null, date: today(), notes: "دفع من محفظة النادي", receivedBy: by });
    const paid = Number(c.paidAmount) + amount;
    await tx.update(charges).set({ paidAmount: paid.toFixed(2), status: paid >= Number(c.amount) - 0.001 ? "PAID" : "PARTIAL" }).where(eq(charges.id, chargeId));
    await tx.insert(walletTx).values({ clubId, amount: (-amount).toFixed(2), kind: "PAYMENT", chargeId, receiptNo, method: "WALLET", notes: c.description, createdBy: by });
    return { receiptNo, amount, partial: amount < remaining - 0.001 };
  });
}

export async function walletPayFin(f: FormData) {
  const u = await requireUser("fin.manage");
  const clubId = int(f, "clubId")!;
  await attempt(`/finance/clubs/${clubId}`, async () => {
    const r = await payFromWallet(int(f, "chargeId")!, clubId, u.fullName);
    await audit(u, "دفع من محفظة نادٍ", "Charge", int(f, "chargeId")!, r);
    return `دُفع ${r.amount.toFixed(2)} د.ل من المحفظة — إيصال ${r.receiptNo}${r.partial ? " (دفع جزئي: الرصيد لا يكفي للمبلغ كاملًا)" : ""}`;
  });
}

export async function walletPayClub(f: FormData) {
  const u = await requireClubUser("club.finance");
  await attempt("/club/finance", async () => {
    const r = await payFromWallet(int(f, "chargeId")!, u.clubId, u.fullName);
    await audit(u, "دفع من محفظة النادي", "Charge", int(f, "chargeId")!, r);
    return `دُفع ${r.amount.toFixed(2)} د.ل من المحفظة — إيصال ${r.receiptNo}${r.partial ? " (دفع جزئي)" : ""}`;
  });
}
