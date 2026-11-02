import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { stadiums } from "@/db/schema";

export type Stadium = typeof stadiums.$inferSelect;

/** سبب منع إقامة مباراة على الملعب في تاريخ معيّن (null = مسموح) */
export function stadiumBlock(s: Stadium | undefined | null, day: string | null): string | null {
  if (!s) return null;
  if (s.status === "CLOSED") return `الملعب «${s.name}» مغلق`;
  if (s.status === "SUSPENDED" && (!s.suspendedUntil || !day || s.suspendedUntil >= day))
    return `الملعب «${s.name}» موقوف${s.suspendedUntil ? ` حتى ${s.suspendedUntil}` : ""}${s.suspensionReason ? ` — ${s.suspensionReason}` : ""}`;
  if (s.approvalUntil && day && s.approvalUntil < day) return `انتهى اعتماد الملعب «${s.name}» في ${s.approvalUntil} — تلزم معاينة جديدة`;
  return null;
}

export async function allStadiums() {
  return db.select().from(stadiums).orderBy(stadiums.name);
}

/** يربط اسم الملعب المكتوب بسجل الملاعب (مطابقة الاسم) */
export async function resolveStadium(name: string | null) {
  if (!name?.trim()) return null;
  const [s] = await db.select().from(stadiums).where(eq(stadiums.name, name.trim()));
  return s ?? null;
}
