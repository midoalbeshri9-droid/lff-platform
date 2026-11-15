"use server";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, homeFor, createPending2fa, readPending2fa, clearPending2fa } from "@/lib/auth";
import { openSecret, verifyTotp, consumeBackupCode } from "@/lib/totp";
import { isClubRole, isOfficialRole } from "@/lib/permissions";
import { audit } from "@/lib/audit";

const MAX_FAILS = 5;
const LOCK_MIN = 15;

export async function login(form: FormData) {
  const username = String(form.get("username") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "");
  const [u] = await db.select().from(users).where(eq(sql`lower(${users.username})`, username)).limit(1);
  if (!u || !u.isActive) {
    await bcrypt.compare(password, "$2a$10$abcdefghijklmnopqrstuuJ5bQe1QbYgGZ7W0h3e3Hn6p7r3s2K6"); // توحيد زمن الاستجابة
    redirect("/login?error=1");
  }
  if (u.lockedUntil && u.lockedUntil > new Date()) {
    const m = Math.ceil((u.lockedUntil.getTime() - Date.now()) / 60000);
    redirect(`/login?error=locked&m=${m}`);
  }
  const ok = await bcrypt.compare(password, u.passwordHash);
  if (!ok) {
    const fails = u.failedLogins + 1;
    await db
      .update(users)
      .set({ failedLogins: fails >= MAX_FAILS ? 0 : fails, lockedUntil: fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MIN * 60000) : null })
      .where(eq(users.id, u.id));
    if (fails >= MAX_FAILS) await audit({ id: u.id, fullName: u.fullName }, "قفل الحساب", "User", u.id, "محاولات دخول فاشلة متكررة");
    redirect("/login?error=1");
  }
  // لا يُكشف أن الحساب غير مفعّل إلا بعد صحة كلمة المرور
  if (!u.isVerified) redirect("/login?error=unverified");
  // التحقق بخطوتين: لا تُنشأ الجلسة قبل إدخال رمز تطبيق المصادقة
  if (u.totpEnabled && u.totpSecret) {
    await createPending2fa(u.id, u.sessionVersion, next);
    redirect("/login/2fa");
  }
  await db.update(users).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, u.id));
  await createSession(u.id, u.sessionVersion);
  await audit({ id: u.id, fullName: u.fullName }, "تسجيل دخول", "User", u.id);
  const home = homeFor({ isClub: isClubRole(u.role), isOfficial: isOfficialRole(u.role), mustChangePassword: u.mustChangePassword });
  const safeNext = /^\/(?![\/\\])/.test(next) && !/[\r\n]/.test(next);
  redirect(safeNext && !u.mustChangePassword ? next : home);
}

/** الخطوة الثانية: رمز تطبيق المصادقة (6 أرقام) أو رمز استرداد */
export async function verify2fa(form: FormData) {
  const p = await readPending2fa();
  if (!p) redirect("/login?error=2fa-expired");
  const code = String(form.get("code") ?? "").trim();
  const [u] = await db.select().from(users).where(eq(users.id, p.uid)).limit(1);
  if (!u || !u.isActive || u.sessionVersion !== p.v || !u.totpEnabled || !u.totpSecret) { await clearPending2fa(); redirect("/login?error=1"); }
  if (u.lockedUntil && u.lockedUntil > new Date()) {
    await clearPending2fa();
    redirect(`/login?error=locked&m=${Math.ceil((u.lockedUntil.getTime() - Date.now()) / 60000)}`);
  }
  const step = /^\d[\d\s]{5,}$/.test(code) ? verifyTotp(openSecret(u.totpSecret), code, u.totpLastStep) : null;
  const rest = step == null ? consumeBackupCode(u.totpBackup, code) : null;
  if (step == null && rest == null) {
    const fails = u.failedLogins + 1;
    await db.update(users).set({ failedLogins: fails >= MAX_FAILS ? 0 : fails, lockedUntil: fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MIN * 60000) : null }).where(eq(users.id, u.id));
    if (fails >= MAX_FAILS) { await audit({ id: u.id, fullName: u.fullName }, "قفل الحساب", "User", u.id, "رموز تحقق خاطئة متكررة"); await clearPending2fa(); redirect(`/login?error=locked&m=${LOCK_MIN}`); }
    redirect("/login/2fa?error=1");
  }
  await db.update(users).set({
    failedLogins: 0, lockedUntil: null, lastLoginAt: new Date(),
    ...(step != null ? { totpLastStep: step } : { totpBackup: rest }),
  }).where(eq(users.id, u.id));
  await clearPending2fa();
  await createSession(u.id, u.sessionVersion);
  await audit({ id: u.id, fullName: u.fullName }, step != null ? "تسجيل دخول (تحقق بخطوتين)" : "تسجيل دخول برمز استرداد", "User", u.id, step == null ? `متبقٍ ${rest!.length} رموز استرداد` : null);
  const home = homeFor({ isClub: isClubRole(u.role), isOfficial: isOfficialRole(u.role), mustChangePassword: u.mustChangePassword });
  const safeNext = /^\/(?![\/\\])/.test(p.next) && !/[\r\n]/.test(p.next);
  redirect(safeNext && !u.mustChangePassword ? p.next : home);
}
