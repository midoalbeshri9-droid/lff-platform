"use server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { contracts, players } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { guard, inScopeClub } from "@/lib/scope";
import { audit, notifyClub } from "@/lib/audit";
import { attempt, str, int, UserError, money } from "@/lib/util";
import { approve } from "@/lib/contracts";

async function load(id: number) {
  const [c] = await db.select({ c: contracts, name: players.fullName }).from(contracts).innerJoin(players, eq(players.id, contracts.playerId)).where(eq(contracts.id, id));
  if (!c) throw new UserError("العقد غير موجود");
  return c;
}

/** اعتماد العقد من لجنة أوضاع اللاعبين وانتقالاتهم */
export async function approveContract(f: FormData) {
  const u = await requireUser("reg.review");
  const id = int(f, "id")!;
  await attempt(`/registration/contracts/${id}`, async () => {
    if (!u.can("reg.contracts")) throw new UserError("اعتماد العقود يتطلب صلاحية الاطلاع على قيم العقود");
    const { c, name } = await load(id);
    guard(await inScopeClub(u, c.clubId));
    const r = await approve(id, u.fullName);
    const fee = r.fee ? ` — وسُجّلت رسوم الاتحاد 3% (${money((Number(c.totalValue) * 0.03).toFixed(2))}) في الحساب المالي للنادي` : "";
    await notifyClub(c.clubId, `اعتُمد عقد اللاعب ${name}`, `رقم العقد ${r.number}${fee}`, `/club/contracts/${id}`);
    await audit(u, "اعتماد عقد محترف", "Contract", id, r.number);
    return `اعتُمد العقد برقم ${r.number}${r.fee ? " وسُجّلت رسوم 3% على النادي" : r.currency !== "LYD" ? " (عملة أجنبية — سجّل رسوم 3% يدويًا من المالية)" : ""}`;
  });
}

/** إعادة العقد للنادي لاستكماله أو تصحيحه */
export async function returnContract(f: FormData) {
  const u = await requireUser("reg.review");
  const id = int(f, "id")!;
  await attempt(`/registration/contracts/${id}`, async () => {
    const note = str(f, "note");
    if (!note) throw new UserError("اكتب ما يجب على النادي تصحيحه");
    const { c, name } = await load(id);
    guard(await inScopeClub(u, c.clubId));
    if (c.status !== "SUBMITTED") throw new UserError("العقد ليس بانتظار الاعتماد");
    await db.update(contracts).set({ status: "RETURNED", returnNote: note, reviewedBy: u.fullName, updatedAt: new Date() }).where(eq(contracts.id, id));
    await notifyClub(c.clubId, `أُعيد عقد اللاعب ${name} للاستكمال`, note, `/club/contracts/${id}`);
    await audit(u, "إعادة عقد للنادي", "Contract", id, note);
    return "أُعيد العقد للنادي مع الملاحظة";
  });
}

/** إنهاء عقد معتمد (فسخ بالتراضي، قرار لجنة، انتقال...) */
export async function terminateContract(f: FormData) {
  const u = await requireUser("reg.edit");
  const id = int(f, "id")!;
  await attempt(`/registration/contracts/${id}`, async () => {
    const reason = str(f, "reason");
    if (!reason) throw new UserError("اكتب سبب إنهاء العقد");
    const { c, name } = await load(id);
    guard(await inScopeClub(u, c.clubId));
    if (c.status !== "ACTIVE") throw new UserError("يمكن إنهاء العقود المعتمدة السارية فقط");
    await db.update(contracts).set({ status: "TERMINATED", terminatedAt: new Date(), terminationReason: reason, updatedAt: new Date() }).where(eq(contracts.id, id));
    await notifyClub(c.clubId, `إنهاء عقد اللاعب ${name}`, reason, `/club/contracts/${id}`);
    await audit(u, "إنهاء عقد محترف", "Contract", id, reason);
    return "سُجّل إنهاء العقد";
  });
}
