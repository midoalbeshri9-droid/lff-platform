"use server";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { attempt, str, UserError } from "@/lib/util";
import { newSecret, sealSecret, openSecret, verifyTotp, newBackupCodes, required2faRoles } from "@/lib/totp";

const BACK = "/profile/2fa";
const CODES_COOKIE = "lff_bk";

async function me(id: number) {
  const [u] = await db.select().from(users).where(eq(users.id, id));
  if (!u) throw new UserError("الحساب غير موجود");
  return u;
}
async function showCodes(codes: string[]) {
  (await cookies()).set(CODES_COOKIE, codes.join(","), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: BACK, maxAge: 600 });
}

/** بدء التفعيل: سر جديد (غير مفعّل حتى يُؤكَّد برمز من التطبيق) */
export async function start2fa() {
  const u = await requireUser();
  await attempt(BACK, async () => {
    const x = await me(u.id);
    if (x.totpEnabled) throw new UserError("التحقق بخطوتين مفعّل مسبقًا");
    await db.update(users).set({ totpSecret: sealSecret(newSecret()), totpLastStep: null }).where(eq(users.id, u.id));
  });
}

/** تأكيد التفعيل برمز من التطبيق، وإصدار رموز الاسترداد */
export async function enable2fa(f: FormData) {
  const u = await requireUser();
  await attempt(BACK, async () => {
    const x = await me(u.id);
    if (x.totpEnabled) throw new UserError("التحقق بخطوتين مفعّل مسبقًا");
    if (!x.totpSecret) throw new UserError("ابدأ التفعيل أولًا");
    const step = verifyTotp(openSecret(x.totpSecret), str(f, "code") ?? "", null);
    if (step == null) throw new UserError("الرمز غير صحيح — تأكد أنك مسحت الرمز الصحيح وأن ساعة الهاتف مضبوطة تلقائيًا");
    const b = newBackupCodes();
    await db.update(users).set({ totpEnabled: true, totpLastStep: step, totpBackup: b.hashes }).where(eq(users.id, u.id));
    await audit(u, "تفعيل التحقق بخطوتين", "User", u.id);
    await showCodes(b.codes);
    return "تم تفعيل التحقق بخطوتين ✓ — احفظ رموز الاسترداد الآن";
  });
}

async function needCode(f: FormData, id: number) {
  const x = await me(id);
  if (!x.totpEnabled || !x.totpSecret) throw new UserError("التحقق بخطوتين غير مفعّل");
  const step = verifyTotp(openSecret(x.totpSecret), str(f, "code") ?? "", x.totpLastStep);
  if (step == null) throw new UserError("رمز التطبيق غير صحيح");
  await db.update(users).set({ totpLastStep: step }).where(eq(users.id, id));
  return x;
}

export async function regenBackup(f: FormData) {
  const u = await requireUser();
  await attempt(BACK, async () => {
    await needCode(f, u.id);
    const b = newBackupCodes();
    await db.update(users).set({ totpBackup: b.hashes }).where(eq(users.id, u.id));
    await audit(u, "إصدار رموز استرداد جديدة", "User", u.id);
    await showCodes(b.codes);
    return "صدرت رموز استرداد جديدة — القديمة لم تعد تعمل";
  });
}

export async function disable2fa(f: FormData) {
  const u = await requireUser();
  await attempt(BACK, async () => {
    if ((await required2faRoles()).includes(u.role)) throw new UserError("دورك ملزم بالتحقق بخطوتين ولا يمكن إيقافه");
    await needCode(f, u.id);
    await db.update(users).set({ totpEnabled: false, totpSecret: null, totpBackup: null, totpLastStep: null }).where(eq(users.id, u.id));
    await audit(u, "إيقاف التحقق بخطوتين", "User", u.id);
    return "تم إيقاف التحقق بخطوتين";
  });
}

export async function hideCodes() {
  await requireUser();
  (await cookies()).set(CODES_COOKIE, "", { path: BACK, maxAge: 0 });
}
