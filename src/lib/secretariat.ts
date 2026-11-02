import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { counters } from "@/db/schema";
import { ROLE_COMMITTEE } from "./labels";

/** رقم تسلسلي سنوي: ص/2026/0001 */
export async function nextSerial(prefix: string, year = new Date().getFullYear()) {
  const [row] = await db.insert(counters).values({ key: `${prefix}:${year}`, value: 1 })
    .onConflictDoUpdate({ target: counters.key, set: { value: sql`${counters.value} + 1` } }).returning();
  return `${prefix}/${year}/${String(row.value).padStart(4, "0")}`;
}

export const committeeOf = (role: string) => ROLE_COMMITTEE[role] ?? null;
