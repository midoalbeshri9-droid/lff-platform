"use server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { assignments, officialExpenses, matches, officials } from "@/db/schema";
import { requireOfficialUser, requireUser } from "@/lib/auth";
import { audit, notifyStaff, notifyOfficial } from "@/lib/audit";
import { addCharge } from "@/lib/finance";
import { saveUpload, ALLOWED_DOC } from "@/lib/storage";
import { attempt, str, int, num, UserError } from "@/lib/util";
import { EXPENSE_KIND } from "@/lib/labels";


/** الحكم/المراقب يقدّم مصاريف مباراة عُيّن فيها (كما في FCMS: Submit match expenses) */
export async function submitExpense(f: FormData) {
  const u = await requireOfficialUser();
  const matchId = int(f, "matchId")!;
  await attempt(`/portal/matches/${matchId}`, async () => {
    const [a] = await db.select().from(assignments).where(and(eq(assignments.matchId, matchId), eq(assignments.officialId, u.officialId), eq(assignments.status, "APPROVED")));
    if (!a) throw new UserError("أنت غير معيّن في هذه المباراة");
    const kind = String(f.get("kind"));
    if (!EXPENSE_KIND[kind]) throw new UserError("اختر نوع المصروف");
    const amount = Number(num(f, "amount"));
    if (!(amount > 0) || amount > 100000) throw new UserError("أدخل مبلغًا صحيحًا");
    const file = f.get("file") as File | null;
    const key = file && file.size ? (await saveUpload(file, "expenses", ALLOWED_DOC, 10 * 1024 * 1024)).key : null;
    const [e] = await db.insert(officialExpenses).values({ officialId: u.officialId, matchId, kind, amount: amount.toFixed(2), description: str(f, "description"), attachmentKey: key }).returning();
    await notifyStaff(["REF_HEAD"], "مصاريف حكم بانتظار الاعتماد", `${u.fullName} — ${amount.toFixed(2)} د.ل`, "/referees/expenses", { matchId });
    await audit(u, "تقديم مصاريف مباراة", "Expense", e.id, { matchId, amount });
    return "أُرسلت المصاريف إلى لجنة الحكام للاعتماد";
  });
}

export async function deleteExpense(f: FormData) {
  const u = await requireOfficialUser();
  const matchId = int(f, "matchId")!;
  await attempt(`/portal/matches/${matchId}`, async () => {
    await db.delete(officialExpenses).where(and(eq(officialExpenses.id, int(f, "id")!), eq(officialExpenses.officialId, u.officialId), eq(officialExpenses.status, "SUBMITTED")));
    return "حُذف المصروف";
  });
}

/** اعتماد المصاريف أو رفضها من لجنة الحكام — المعتمد يصبح مستحقًا للحكم في المالية */
export async function reviewExpense(f: FormData) {
  const u = await requireUser("ref.approve");
  await attempt("/referees/expenses", async () => {
    const id = int(f, "id")!;
    const ok = f.get("decision") === "approve";
    const note = str(f, "note");
    const [e] = await db.select().from(officialExpenses).where(eq(officialExpenses.id, id));
    if (!e || e.status !== "SUBMITTED") throw new UserError("الطلب غير متاح");
    if (!ok && !note) throw new UserError("اكتب سبب الرفض");
    const amount = ok ? Number(num(f, "amount") ?? e.amount) : Number(e.amount);
    if (ok && !(amount > 0)) throw new UserError("المبلغ غير صحيح");
    await db.transaction(async (tx) => {
      let chargeId: number | null = null;
      if (ok) {
        const [m] = await tx.select({ round: matches.round }).from(matches).where(eq(matches.id, e.matchId));
        chargeId = await addCharge(tx, { direction: "OUT", officialId: e.officialId, category: "REFEREE_FEE", description: `مصاريف مباراة (ج${m?.round ?? ""}) — ${EXPENSE_KIND[e.kind] ?? e.kind}${e.description ? `: ${e.description}` : ""}`, amount: amount.toFixed(2), refType: "expense", refId: e.id, createdBy: u.fullName });
      }
      await tx.update(officialExpenses).set({ status: ok ? "APPROVED" : "REJECTED", amount: amount.toFixed(2), reviewNote: note, reviewedBy: u.fullName, reviewedAt: new Date(), chargeId }).where(eq(officialExpenses.id, id));
    });
    const [o] = await db.select({ name: officials.fullName }).from(officials).where(eq(officials.id, e.officialId));
    await notifyOfficial(e.officialId, ok ? "اعتُمدت مصاريفك" : "رُفضت مصاريفك", ok ? `${amount.toFixed(2)} د.ل — تُصرف من اللجنة المالية` : note, "/portal");
    await audit(u, ok ? "اعتماد مصاريف حكم" : "رفض مصاريف حكم", "Expense", id, { official: o?.name, amount });
    return ok ? "اعتُمدت وسُجّلت مستحقًا للحكم في المالية" : "رُفضت";
  });
}
