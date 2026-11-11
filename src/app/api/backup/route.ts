import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { listObjects, readObject, mimeOf } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * تنزيل الملفات المرفوعة للنسخ الاحتياطي — بمفتاح مؤقت يضعه برنامج النسخ (neon-backup) في الإعدادات مباشرة
 * عبر قاعدة البيانات، ويحذفه بعد الانتهاء. لا جلسة دخول ولا مفاتيح تخزين على جهاز المستخدم.
 *   GET /api/backup            → قائمة الملفات
 *   GET /api/backup?key=<key>  → محتوى ملف
 */
async function authorized(req: Request) {
  const k = req.headers.get("x-backup-key") ?? "";
  if (k.length < 32) return false;
  const [row] = await db.select().from(settings).where(eq(settings.key, "backup_key_hash"));
  if (!row?.value) return false;
  const [hash, exp] = row.value.split("|");
  if (!exp || Date.now() > Number(exp)) return false;
  const a = Buffer.from(crypto.createHash("sha256").update(k).digest("hex")), b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  if (!(await authorized(req))) return new Response("unauthorized", { status: 401 });
  const key = new URL(req.url).searchParams.get("key");
  if (!key) return Response.json(await listObjects());
  if (key.includes("..") || key.startsWith("/")) return new Response("bad key", { status: 400 });
  const buf = await readObject(key);
  if (!buf) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": mimeOf(key), "Cache-Control": "no-store" } });
}
