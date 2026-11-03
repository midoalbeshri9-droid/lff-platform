import "server-only";
import { eq, inArray, or, and } from "drizzle-orm";
import { db } from "@/db";
import { divisions, clubs, officials, users, type Role } from "@/db/schema";
import type { CurrentUser } from "./auth";
import { SCOPEABLE, PERMISSION_GROUPS } from "./permissions";
import { UserError } from "./util";

export type DivCtx = { id: number; name: string; admin: boolean };

/** الدرجة التي تُدار: درجة المستخدم المحصور، أو درجة يختارها مدير المنظومة */
export async function divContext(u: CurrentUser, requested?: number | null): Promise<DivCtx | null> {
  const id = u.divisionId ?? (u.role === "ADMIN" ? requested ?? null : null);
  if (!id) return null;
  const [d] = await db.select({ id: divisions.id, name: divisions.name }).from(divisions).where(eq(divisions.id, id));
  return d ? { ...d, admin: !u.divisionId } : null;
}
export async function requireDiv(u: CurrentUser, requested?: number | null) {
  const d = await divContext(u, requested);
  if (!d) throw new UserError("اختر الدرجة");
  return d;
}

/** الأدوار التي ينشئها مدير الدرجة (ومدير المنظومة يضيف مدير الدرجة أيضًا) */
export const DIV_CREATABLE: Role[] = ["DIV_STAFF", "CLUB_MANAGER", "CLUB_EMPLOYEE", "CLUB_VIEWER", "REFEREE", "OBSERVER"];

/** الصلاحيات التي يمنحها المستخدم لموظفي درجته: ما يملكه هو فقط (والمدير: كل صلاحيات الدرجة) */
export function grantable(u: CurrentUser) {
  const all = PERMISSION_GROUPS.flatMap((g) => g.items.map(([k, label]) => ({ k, label, group: g.group }))).filter((p) => SCOPEABLE.has(p.k));
  return u.role === "ADMIN" ? all : all.filter((p) => u.can(p.k));
}

/** معرّفات أندية الدرجة وحكامها */
export async function divIds(divisionId: number) {
  const cl = await db.select({ id: clubs.id }).from(clubs).where(eq(clubs.divisionId, divisionId));
  const of = await db.select({ id: officials.id }).from(officials).where(eq(officials.divisionId, divisionId));
  return { clubIds: cl.map((x) => x.id), officialIds: of.map((x) => x.id) };
}

/** مستخدمو الدرجة: موظفوها، وحسابات أنديتها، وحسابات حكامها */
export async function divUsersWhere(divisionId: number) {
  const { clubIds, officialIds } = await divIds(divisionId);
  return or(
    eq(users.divisionId, divisionId),
    clubIds.length ? inArray(users.clubId, clubIds) : undefined,
    officialIds.length ? inArray(users.officialId, officialIds) : undefined,
  );
}

/** هل الحساب ضمن الدرجة ويجوز لهذا المستخدم إدارته؟ */
export async function canManageUser(u: CurrentUser, d: DivCtx, targetId: number) {
  const where = await divUsersWhere(d.id);
  const [t] = await db.select().from(users).where(and(eq(users.id, targetId), where));
  if (!t) return null;
  if (t.role === "ADMIN") return null;
  // مدير الدرجة لا يدير حسابه ولا حسابات مديري الدرجات (هذه لمدير المنظومة)
  if (!d.admin && (t.id === u.id || t.role === "DIV_MANAGER")) return null;
  // حسابات لجان الاتحاد المحصورة في الدرجة يديرها مدير المنظومة
  if (!d.admin && t.divisionId && !["DIV_STAFF"].includes(t.role)) return null;
  return t;
}
