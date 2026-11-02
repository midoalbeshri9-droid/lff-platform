import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, rolePermissions, clubs, officials, type Role } from "@/db/schema";
import { DEFAULT_PERMISSIONS, isClubRole, isOfficialRole } from "./permissions";

export const SESSION_COOKIE = "lff_session";
const SESSION_HOURS = 12;

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("AUTH_SECRET غير مضبوط (32 حرفًا على الأقل)");
  return new TextEncoder().encode(s);
}

export async function createSession(userId: number, version: number) {
  const token = await new SignJWT({ uid: userId, v: version })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secret());
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
}

export async function destroySession() {
  (await cookies()).delete(SESSION_COOKIE);
}

export type CurrentUser = {
  id: number;
  username: string;
  fullName: string;
  role: Role;
  clubId: number | null;
  clubName: string | null;
  officialId: number | null;
  officialType: string | null;
  mustChangePassword: boolean;
  perms: Set<string>;
  isClub: boolean;
  isOfficial: boolean;
  can: (p: string) => boolean;
  canAny: (...p: string[]) => boolean;
};

export const getPermissionsFor = cache(async (role: Role): Promise<Set<string>> => {
  const rows = await db.select().from(rolePermissions).where(eq(rolePermissions.role, role));
  // إن لم تُضبط المصفوفة لهذا الدور بعد، تُستخدم الافتراضية
  if (rows.length === 0) return new Set(DEFAULT_PERMISSIONS[role] ?? []);
  return new Set(rows.map((r) => r.permission));
});

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  let uid: number, v: number;
  try {
    const { payload } = await jwtVerify(token, secret());
    uid = Number(payload.uid);
    v = Number(payload.v);
  } catch {
    return null;
  }
  const [row] = await db
    .select({
      u: users,
      clubName: clubs.name,
      officialType: officials.type,
    })
    .from(users)
    .leftJoin(clubs, eq(users.clubId, clubs.id))
    .leftJoin(officials, eq(users.officialId, officials.id))
    .where(eq(users.id, uid))
    .limit(1);
  if (!row || !row.u.isActive || row.u.sessionVersion !== v) return null;
  const u = row.u;
  const perms = await getPermissionsFor(u.role);
  if (u.role === "ADMIN") {
    // مدير المنظومة لا يفقد صلاحيات الإدارة أبدًا
    ["admin.users", "admin.permissions"].forEach((p) => perms.add(p));
  }
  return {
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    role: u.role,
    clubId: u.clubId,
    clubName: row.clubName,
    officialId: u.officialId,
    officialType: row.officialType,
    mustChangePassword: u.mustChangePassword,
    perms,
    isClub: isClubRole(u.role),
    isOfficial: isOfficialRole(u.role),
    can: (p) => perms.has(p),
    canAny: (...ps) => ps.some((p) => perms.has(p)),
  };
});

/** يتطلب مستخدمًا مسجلًا؛ وإن أُعطيت صلاحيات فيكفي امتلاك إحداها */
export async function requireUser(...anyOf: string[]): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  if (anyOf.length && !u.canAny(...anyOf)) redirect("/denied");
  return u;
}

/** حساب نادٍ مرتبط بنادٍ فعلي */
export async function requireClubUser(...anyOf: string[]) {
  const u = await requireUser(...anyOf);
  if (!u.isClub || !u.clubId) redirect("/denied");
  return u as CurrentUser & { clubId: number; clubName: string };
}

/** حساب حكم أو مراقب مرتبط بسجل في لجنة الحكام */
export async function requireOfficialUser() {
  const u = await requireUser("portal.referee", "portal.observer");
  if (!u.officialId) redirect("/denied");
  return u as CurrentUser & { officialId: number };
}

export function homeFor(u: Pick<CurrentUser, "isClub" | "isOfficial" | "mustChangePassword">) {
  if (u.mustChangePassword) return "/profile?mustchange=1";
  if (u.isClub) return "/club";
  if (u.isOfficial) return "/portal";
  return "/dashboard";
}
