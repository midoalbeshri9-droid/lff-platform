import "server-only";
import { and, eq, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { UserError } from "./util";

/** يتحقق أن البريد والهاتف غير مستخدمين في حساب آخر */
export async function ensureUniqueContact(email: string, phone: string, exceptId?: number | null) {
  const rows = await db.select({ id: users.id, email: users.email, phone: users.phone }).from(users)
    .where(and(or(eq(sql`lower(${users.email})`, email), eq(users.phone, phone)), exceptId ? ne(users.id, exceptId) : undefined));
  if (rows.some((r) => r.email?.toLowerCase() === email)) throw new UserError("البريد الإلكتروني مستخدم في حساب آخر");
  if (rows.some((r) => r.phone === phone)) throw new UserError("رقم الهاتف مستخدم في حساب آخر");
}

export const sentMsg = (sent: boolean) =>
  sent ? "أُرسل رابط التفعيل إلى البريد" : "البريد غير مُعدّ — انسخ رابط التفعيل من «صندوق الرسائل» وأرسله للمستخدم";
