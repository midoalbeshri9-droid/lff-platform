"use server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { charges, payments, feeTypes, refereeRates, settings } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { audit, notifyClub, notifyOfficial } from "@/lib/audit";
import { nextReceiptNo, addCharge } from "@/lib/finance";
import { saveUpload } from "@/lib/storage";
import { attempt, str, req, int, ints, num, bool, UserError, today } from "@/lib/util";

const backFor = (c: { clubId: number | null; officialId: number | null }) => (c.clubId ? `/finance/clubs/${c.clubId}` : `/finance/officials/${c.officialId}`);

async function applyPayment(chargeId: number, amount: number, by: string, extra: { method: string; reference: string | null; date: string; attachmentKey: string | null; notes: string | null }) {
  const [c] = await db.select().from(charges).where(eq(charges.id, chargeId));
  if (!c || ["PAID", "WAIVED", "CANCELLED"].includes(c.status)) throw new UserError("المستحق مدفوع أو ملغى");
  const remaining = Number(c.amount) - Number(c.paidAmount);
  if (!(amount > 0)) throw new UserError("المبلغ يجب أن يكون أكبر من صفر");
  if (amount > remaining + 0.001) throw new UserError(`المبلغ أكبر من المتبقي (${remaining.toFixed(2)})`);
  let receiptNo = "";
  await db.transaction(async (tx) => {
    // إعادة القراءة داخل المعاملة مع قفل السطر: يمنع تسجيل دفعتين متزامنتين تتجاوزان المتبقي
    const [cur] = await tx.select().from(charges).where(eq(charges.id, chargeId)).for("update");
    if (!cur || ["PAID", "WAIVED", "CANCELLED"].includes(cur.status)) throw new UserError("المستحق مدفوع أو ملغى");
    if (amount > Number(cur.amount) - Number(cur.paidAmount) + 0.001) throw new UserError(`المبلغ أكبر من المتبقي (${(Number(cur.amount) - Number(cur.paidAmount)).toFixed(2)})`);
    c.paidAmount = cur.paidAmount;
    receiptNo = await nextReceiptNo(tx, c.direction === "IN" ? "R" : "P");
    await tx.insert(payments).values({
      receiptNo, direction: c.direction, chargeId, clubId: c.clubId, officialId: c.officialId, amount: amount.toFixed(2),
      method: extra.method, reference: extra.reference, date: extra.date, attachmentKey: extra.attachmentKey, notes: extra.notes, receivedBy: by,
    });
    const paid = Number(c.paidAmount) + amount;
    await tx.update(charges).set({ paidAmount: paid.toFixed(2), status: paid >= Number(c.amount) - 0.001 ? "PAID" : "PARTIAL" }).where(eq(charges.id, chargeId));
  });
  return { receiptNo, c };
}

export async function recordPayment(f: FormData) {
  const u = await requireUser("fin.manage");
  const chargeId = int(f, "chargeId")!;
  const [c0] = await db.select().from(charges).where(eq(charges.id, chargeId));
  await attempt(c0 ? backFor(c0) : "/finance", async () => {
    const file = f.get("attachment") as File | null;
    const attachmentKey = file && file.size ? (await saveUpload(file, "finance")).key : null;
    const { receiptNo, c } = await applyPayment(chargeId, Number(num(f, "amount")), u.fullName, {
      method: req(f, "method", "طريقة الدفع"), reference: str(f, "reference"), date: str(f, "date") ?? today(), attachmentKey, notes: str(f, "notes"),
    });
    if (c.clubId) await notifyClub(c.clubId, `إيصال استلام ${receiptNo}`, `${c.description} — ${num(f, "amount")} د.ل`, "/club/finance");
    if (c.officialId) await notifyOfficial(c.officialId, `صرف مستحقات ${receiptNo}`, c.description, "/portal");
    await audit(u, "تسجيل دفعة", "Charge", chargeId, { receiptNo, amount: num(f, "amount") });
    return `تم تسجيل الدفعة — إيصال رقم ${receiptNo}`;
  });
}

/** صرف عدة مستحقات حكم دفعة واحدة */
export async function payOfficialBulk(f: FormData) {
  const u = await requireUser("fin.manage");
  const officialId = int(f, "officialId")!;
  await attempt(`/finance/officials/${officialId}`, async () => {
    const ids = ints(f, "charge");
    if (!ids.length) throw new UserError("حدد المستحقات");
    const rows = await db.select().from(charges).where(and(inArray(charges.id, ids), eq(charges.officialId, officialId), eq(charges.direction, "OUT")));
    let n = 0, total = 0;
    for (const c of rows) {
      const rem = Number(c.amount) - Number(c.paidAmount);
      if (rem <= 0 || !["OPEN", "PARTIAL"].includes(c.status)) continue;
      await applyPayment(c.id, rem, u.fullName, { method: req(f, "method", "طريقة الصرف"), reference: str(f, "reference"), date: str(f, "date") ?? today(), attachmentKey: null, notes: "صرف جماعي" });
      n++; total += rem;
    }
    await notifyOfficial(officialId, "صرف مستحقات التحكيم", `${n} مباراة — ${total.toFixed(2)} د.ل`, "/portal");
    await audit(u, "صرف مستحقات حكم", "Official", officialId, { n, total });
    return `تم صرف ${n} مستحق بإجمالي ${total.toFixed(2)} د.ل`;
  });
}

export async function addManualCharge(f: FormData) {
  const u = await requireUser("fin.manage");
  const clubId = int(f, "clubId"), officialId = int(f, "officialId");
  await attempt(clubId ? `/finance/clubs/${clubId}` : `/finance/officials/${officialId}`, async () => {
    const id = await addCharge(db, {
      direction: officialId ? "OUT" : "IN", clubId, officialId, category: req(f, "category", "النوع"), description: req(f, "description", "البيان"),
      amount: num(f, "amount") ?? 0, dueDate: str(f, "dueDate"), createdBy: u.fullName,
    });
    if (!id) throw new UserError("المبلغ غير صحيح");
    if (clubId) await notifyClub(clubId, "مستحق مالي جديد", str(f, "description"), "/club/finance");
    await audit(u, "إضافة مستحق", "Charge", id);
    return "تمت إضافة المستحق";
  });
}

export async function waiveCharge(f: FormData) {
  const u = await requireUser("fin.approve");
  const id = int(f, "chargeId")!;
  const [c] = await db.select().from(charges).where(eq(charges.id, id));
  await attempt(c ? backFor(c) : "/finance", async () => {
    const reason = req(f, "reason", "سبب الإعفاء");
    if (!["OPEN", "PARTIAL"].includes(c.status)) throw new UserError("لا يمكن الإعفاء");
    // الإعفاء من المتبقي فقط — المدفوع يبقى مسجلًا
    await db.update(charges).set({ status: Number(c.paidAmount) > 0 ? "PAID" : "WAIVED", amount: Number(c.paidAmount) > 0 ? c.paidAmount : c.amount, waiveReason: reason }).where(eq(charges.id, id));
    await audit(u, "إعفاء من مستحق", "Charge", id, { reason, amount: c.amount });
    return "تم الإعفاء";
  });
}

export async function voidPayment(f: FormData) {
  const u = await requireUser("fin.approve");
  const id = int(f, "paymentId")!;
  const [p] = await db.select().from(payments).where(eq(payments.id, id));
  await attempt(p ? (p.clubId ? `/finance/clubs/${p.clubId}` : `/finance/officials/${p.officialId}`) : "/finance", async () => {
    if (!p || p.isVoided) throw new UserError("الإيصال ملغى مسبقًا");
    const reason = req(f, "reason", "سبب الإلغاء");
    await db.transaction(async (tx) => {
      await tx.update(payments).set({ isVoided: true, notes: `ملغى: ${reason}` }).where(eq(payments.id, id));
      const [c] = await tx.select().from(charges).where(eq(charges.id, p.chargeId));
      const paid = Math.max(0, Number(c.paidAmount) - Number(p.amount));
      await tx.update(charges).set({ paidAmount: paid.toFixed(2), status: paid <= 0 ? "OPEN" : "PARTIAL" }).where(eq(charges.id, c.id));
    });
    await audit(u, "إلغاء إيصال", "Payment", id, reason);
    return "أُلغي الإيصال وأُعيد المستحق";
  });
}

export async function saveFee(f: FormData) {
  const u = await requireUser("fin.settings");
  await attempt("/finance/settings", async () => {
    const id = int(f, "id")!;
    await db.update(feeTypes).set({ amount: num(f, "amount") ?? "0", amountPro: num(f, "amountPro"), isActive: bool(f, "isActive") }).where(eq(feeTypes.id, id));
    await audit(u, "تعديل رسم", "FeeType", id);
    return "تم الحفظ";
  });
}

export async function saveRate(f: FormData) {
  const u = await requireUser("fin.settings");
  await attempt("/finance/settings#rates", async () => {
    const role = req(f, "role", "الدور") as "REFEREE";
    const grade = (str(f, "grade") as "FIRST") ?? null;
    const amount = num(f, "amount");
    if (!amount) throw new UserError("حدد المبلغ");
    const [ex] = await db.select().from(refereeRates).where(and(eq(refereeRates.role, role), grade ? eq(refereeRates.grade, grade) : undefined));
    if (ex && ex.grade === grade) await db.update(refereeRates).set({ amount }).where(eq(refereeRates.id, ex.id));
    else await db.insert(refereeRates).values({ role, grade, amount });
    await audit(u, "تعديل أجر تحكيم", "RefereeRate", null, { role, grade, amount });
    return "تم الحفظ";
  });
}

export async function deleteRate(f: FormData) {
  const u = await requireUser("fin.settings");
  await attempt("/finance/settings#rates", async () => {
    await db.delete(refereeRates).where(eq(refereeRates.id, int(f, "id")!));
    await audit(u, "حذف أجر تحكيم", "RefereeRate", int(f, "id"));
    return "تم الحذف";
  });
}

export async function saveFinSettings(f: FormData) {
  const u = await requireUser("fin.settings");
  await attempt("/finance/settings", async () => {
    const vals: Record<string, string> = {
      block_overdue: bool(f, "block_overdue") ? "1" : "0", block_overdue_min: String(num(f, "block_overdue_min") ?? "0"), overdue_days: String(int(f, "overdue_days") ?? 30),
    };
    for (const [key, value] of Object.entries(vals)) await db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
    await audit(u, "إعدادات المالية", "Setting", null, vals);
    return "تم الحفظ";
  });
}
