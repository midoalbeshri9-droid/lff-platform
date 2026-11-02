import "server-only";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { userTokens, users } from "@/db/schema";
import { sendMail } from "./mail";

const sha = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
export const appUrl = () =>
  (process.env.APP_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")).replace(/\/$/, "");
export const unusableHash = () => bcrypt.hashSync(crypto.randomBytes(24).toString("hex"), 8);

export async function createToken(userId: number, kind: "VERIFY" | "RESET" | "EMAIL_CHANGE", hours: number, newEmail?: string) {
  const raw = crypto.randomBytes(32).toString("base64url");
  // إبطال الرموز السابقة من نفس النوع
  await db.update(userTokens).set({ usedAt: new Date() }).where(and(eq(userTokens.userId, userId), eq(userTokens.kind, kind), isNull(userTokens.usedAt)));
  await db.insert(userTokens).values({ userId, kind, tokenHash: sha(raw), newEmail: newEmail ?? null, expiresAt: new Date(Date.now() + hours * 3600_000) });
  return raw;
}

/** يتحقق من الرمز دون استهلاكه */
export async function peekToken(raw: string, kind: "VERIFY" | "RESET" | "EMAIL_CHANGE") {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(raw)) return null;
  const [t] = await db.select({ t: userTokens, u: users }).from(userTokens).innerJoin(users, eq(users.id, userTokens.userId))
    .where(and(eq(userTokens.tokenHash, sha(raw)), eq(userTokens.kind, kind), isNull(userTokens.usedAt), gt(userTokens.expiresAt, new Date())));
  return t ?? null;
}

export async function consumeToken(id: number) {
  await db.update(userTokens).set({ usedAt: new Date() }).where(eq(userTokens.id, id));
}

/** إرسال رابط التفعيل لحساب جديد */
export async function sendActivation(user: { id: number; email: string | null; fullName: string; username: string }) {
  if (!user.email) return { sent: false, link: null };
  const raw = await createToken(user.id, "VERIFY", 72);
  const link = `${appUrl()}/activate/${raw}`;
  const r = await sendMail({
    to: user.email, userId: user.id, subject: "تفعيل حسابك في منظومة الاتحاد الليبي لكرة القدم",
    text: `مرحبًا ${user.fullName}،\nأُنشئ لك حساب في المنظومة باسم المستخدم: ${user.username}\nاضغط الرابط لتفعيل الحساب واختيار كلمة المرور. الرابط صالح 72 ساعة.`,
    link, linkText: "تفعيل الحساب",
  });
  return { sent: r.sent, link };
}

export async function sendReset(user: { id: number; email: string | null; fullName: string; username: string }) {
  if (!user.email) return { sent: false, link: null };
  const raw = await createToken(user.id, "RESET", 2);
  const link = `${appUrl()}/reset/${raw}`;
  const r = await sendMail({
    to: user.email, userId: user.id, subject: "استعادة كلمة المرور",
    text: `مرحبًا ${user.fullName}،\nطُلبت استعادة كلمة المرور لحسابك (${user.username}). الرابط صالح ساعتين. إن لم تطلب ذلك تجاهل الرسالة.`,
    link, linkText: "تعيين كلمة مرور جديدة",
  });
  return { sent: r.sent, link };
}
