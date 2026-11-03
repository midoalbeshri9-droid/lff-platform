import "server-only";
import { inArray, eq, and, isNull, or } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { auditLogs, notifications, users, clubs, matches, competitions, type Role } from "@/db/schema";
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
    : and(inArray(users.role, roles), eq(users.isActive, true), isNull(users.divisionId));
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

/**
 * إشعار لجان الاتحاد + مدير/موظفي الدرجة المعنية بالنادي أو المباراة.
 * مستخدمو الاتحاد المحصورون بدرجة لا يصلهم إلا ما يخص درجتهم.
 */
export async function notifyStaff(roles: Role[], title: string, body: string | null, link: string | null, about: { clubId?: number | null; matchId?: number | null }, tx?: Tx) {
  const q = tx ?? db;
  let div: number | null = null;
  if (about.matchId) {
    const [m] = await q.select({ d: competitions.divisionId }).from(matches).innerJoin(competitions, eq(competitions.id, matches.competitionId)).where(eq(matches.id, about.matchId));
    div = m?.d ?? null;
  } else if (about.clubId) {
    const [c] = await q.select({ d: clubs.divisionId }).from(clubs).where(eq(clubs.id, about.clubId));
    div = c?.d ?? null;
  }
  const where = div
    ? and(eq(users.isActive, true), or(
        and(inArray(users.role, roles), or(isNull(users.divisionId), eq(users.divisionId, div))),
        and(inArray(users.role, ["DIV_MANAGER", "DIV_STAFF"]), eq(users.divisionId, div)),
      ))
    : and(eq(users.isActive, true), inArray(users.role, roles), isNull(users.divisionId));
  const rows = await q.select({ id: users.id }).from(users).where(where);
  if (rows.length) await q.insert(notifications).values(rows.map((r) => ({ userId: r.id, title, body, link })));
}
