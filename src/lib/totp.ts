import "server-only";
import crypto from "crypto";
import { getSetting } from "./registration";
import type { Role } from "@/db/schema";

/** التحقق بخطوتين عبر تطبيقات المصادقة (Google Authenticator / Microsoft Authenticator) — معيار TOTP (RFC 6238) */
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function b32encode(buf: Buffer) {
  let bits = 0, val = 0, out = "";
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function b32decode(s: string) {
  const clean = s.replace(/[\s=]/g, "").toUpperCase();
  let bits = 0, val = 0; const out: number[] = [];
  for (const c of clean) { const i = B32.indexOf(c); if (i < 0) continue; val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
const STEP = 30;
function hotp(key: Buffer, counter: number) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", key).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, "0");
}
export const newSecret = () => b32encode(crypto.randomBytes(20));
export const formatSecret = (s: string) => s.match(/.{1,4}/g)!.join(" ");
export function otpauthUrl(secret: string, account: string) {
  return `otpauth://totp/${encodeURIComponent(`LFF:${account}`)}?secret=${secret}&issuer=${encodeURIComponent("LFF")}&algorithm=SHA1&digits=6&period=30`;
}
/** يعيد رقم الخطوة الزمنية المطابقة (±30 ثانية) أو null — ويرفض إعادة استخدام رمز سبق قبوله */
export function verifyTotp(secret: string, code: string, lastStep: number | null) {
  const c = code.replace(/\D/g, "");
  if (c.length !== 6) return null;
  const key = b32decode(secret);
  const now = Math.floor(Date.now() / 1000 / STEP);
  for (const s of [now, now - 1, now + 1]) {
    if (lastStep != null && s <= lastStep) continue;
    const a = Buffer.from(hotp(key, s)), b = Buffer.from(c);
    if (crypto.timingSafeEqual(a, b)) return s;
  }
  return null;
}

// تشفير السر بمفتاح مشتق من AUTH_SECRET (AES-256-GCM) — تسريب قاعدة البيانات وحده لا يكشف الأسرار
function key() {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET غير مضبوط");
  return crypto.createHash("sha256").update(`${s}|totp`).digest();
}
export function sealSecret(secret: string) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(secret, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(".");
}
export function openSecret(sealed: string) {
  const [v, iv, tag, enc] = sealed.split(".");
  if (v !== "v1") throw new Error("صيغة غير معروفة");
  const d = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64")), d.final()]).toString("utf8");
}

/** رموز الاسترداد: 8 رموز تُستخدم مرة واحدة عند فقدان الهاتف */
const hashCode = (c: string) => crypto.createHash("sha256").update(c.replace(/[\s-]/g, "").toUpperCase()).digest("hex");
export function newBackupCodes() {
  const codes = Array.from({ length: 8 }, () => { const r = b32encode(crypto.randomBytes(5)).slice(0, 8); return `${r.slice(0, 4)}-${r.slice(4)}`; });
  return { codes, hashes: codes.map(hashCode) };
}
/** يعيد قائمة البصمات بعد حذف الرمز المستخدم، أو null إن لم يطابق */
export function consumeBackupCode(hashes: string[] | null, code: string) {
  const h = hashCode(code);
  if (!hashes?.includes(h)) return null;
  return hashes.filter((x) => x !== h);
}

/** الأدوار الملزمة بالتحقق بخطوتين (قابلة للتعديل من إعدادات النظام) */
export const DEFAULT_2FA_ROLES: Role[] = ["ADMIN", "PRESIDENT", "SECRETARY_GENERAL", "REG_HEAD", "COMP_HEAD", "REF_HEAD", "FIN_HEAD", "FIN_STAFF"];
export async function required2faRoles(): Promise<Role[]> {
  const v = await getSetting("require_2fa_roles", DEFAULT_2FA_ROLES.join(","));
  return v.split(",").map((x) => x.trim()).filter(Boolean) as Role[];
}
