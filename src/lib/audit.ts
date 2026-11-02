import "server-only";
import { inArray, eq, and } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { auditLogs, notifications, users, type Role } from "@/db/schema";
import type { CurrentUser } from "./auth";

export async function audit(
  u: Pick<CurrentUser, "id" | "fullName"> | null,
  action: string,
  entity: string,
  entityId?: string | number | null,
  details?: unknown,
  tx?: Tx,
) {
  await (tx ?? db).insert(auditLogs).values({
    userId: u?.id ?? null,
    userName: u?.fullName ?? "النظام",
    action,
    entity,
    entityId: entityId == null ? null : String(entityId),
    details: details == null ? null : typeof details === "string" ? details : JSON.stringify(details),
  });
}

/** إشعار لكل مستخدمي أدوار معيّنة (اختياريًا لنادٍ محدد) */
export async function notifyRoles(roles: Role[], title: string, body: string | null, link: string | null, clubId?: number, tx?: Tx) {
  const q = tx ?? db;
  const where = clubId
    ? and(inArray(users.role, roles), eq(users.clubId, clubId), eq(users.isActive, true))
    : and(inArray(users.role, roles), eq(users.isActive, true));
  const rows = await q.select({ id: users.id }).from(users).where(where);
  if (rows.length) await q.insert(notifications).values(rows.map((r) => ({ userId: r.id, title, body, link })));
}

export async function notifyClub(clubId: number, title: string, body: string | null, link: string | null, tx?: Tx) {
  return notifyRoles(["CLUB_MANAGER", "CLUB_EMPLOYEE", "CLUB_VIEWER"], title, body, link, clubId, tx);
}

export async function notifyOfficial(officialId: number, title: string, body: string | null, link: string | null, tx?: Tx) {
  const q = tx ?? db;
  const rows = await q.select({ id: users.id }).from(users).where(eq(users.officialId, officialId));
  if (rows.length) await q.insert(notifications).values(rows.map((r) => ({ userId: r.id, title, body, link })));
}
