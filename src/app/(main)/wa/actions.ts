"use server";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { waOutbox } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";

/** عُلِّمت الرسالة كمُرسلة بعد فتح واتساب */
export async function waDone(id: number) {
  const u = await getCurrentUser();
  if (!u) return;
  await db.update(waOutbox).set({ status: "DONE", doneAt: new Date() }).where(and(eq(waOutbox.id, id), eq(waOutbox.userId, u.id)));
  revalidatePath("/", "layout");
}

export async function waDismissAll() {
  const u = await getCurrentUser();
  if (!u) return;
  await db.update(waOutbox).set({ status: "DISMISSED", doneAt: new Date() }).where(and(eq(waOutbox.userId, u.id), inArray(waOutbox.status, ["PENDING", "NO_PHONE", "FAILED"])));
  revalidatePath("/", "layout");
}
