import "server-only";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { UserError } from "./util";

// التخزين: محلي أثناء التطوير، وCloudflare R2 (متوافق S3) عند النشر
const driver = process.env.STORAGE_DRIVER ?? "local";
const localDir = path.resolve(process.env.STORAGE_DIR ?? "./storage");

let s3: S3Client | null = null;
function client() {
  if (!s3) {
    s3 = new S3Client({
      region: process.env.S3_REGION ?? "auto",
      endpoint: process.env.S3_ENDPOINT,
      credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! },
    });
  }
  return s3;
}
const bucket = () => process.env.S3_BUCKET!;

export const ALLOWED_DOC = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
export const ALLOWED_IMG = ["image/jpeg", "image/png", "image/webp"];
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
/** الأرشيف الإلكتروني يقبل أيضًا ملفات Word وExcel */
export const ALLOWED_ARCHIVE = [...ALLOWED_DOC, DOCX, XLSX, "application/msword", "application/vnd.ms-excel"];
const EXT: Record<string, string> = {
  "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
  [DOCX]: "docx", [XLSX]: "xlsx", "application/msword": "doc", "application/vnd.ms-excel": "xls",
};
const MAX = 8 * 1024 * 1024;

export type Saved = { key: string; mime: string; size: number; name: string; hash: string };

export async function saveUpload(file: File, folder: string, allowed = ALLOWED_DOC, max = MAX): Promise<Saved> {
  if (!file || file.size === 0) throw new UserError("لم يتم اختيار ملف");
  if (file.size > max) throw new UserError(`حجم الملف أكبر من ${Math.round(max / 1048576)} ميغابايت`);
  if (!allowed.includes(file.type)) throw new UserError(allowed.length > ALLOWED_DOC.length ? "نوع الملف غير مسموح (PDF أو صورة أو Word أو Excel)" : "نوع الملف غير مسموح (PDF أو صورة فقط)");
  const buf = Buffer.from(await file.arrayBuffer());
  // تحقق بسيط من توقيع الملف لمنع رفع ملفات متنكرة
  const sig = buf.subarray(0, 4).toString("hex");
  const okSig = sig.startsWith("25504446") || sig.startsWith("ffd8ff") || sig === "89504e47" || sig === "52494646"
    || (sig === "504b0304" && [DOCX, XLSX].includes(file.type)) || (sig === "d0cf11e0" && ["application/msword", "application/vnd.ms-excel"].includes(file.type));
  if (!okSig) throw new UserError("محتوى الملف لا يطابق نوعه");
  const hash = crypto.createHash("sha256").update(buf).digest("hex");
  const key = `${folder}/${new Date().getFullYear()}/${crypto.randomUUID()}.${EXT[file.type]}`;
  await putObject(key, buf, file.type);
  return { key, mime: file.type, size: file.size, name: file.name.slice(0, 200), hash };
}

export async function putObject(key: string, buf: Buffer, mime: string) {
  if (driver === "s3") {
    await client().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: buf, ContentType: mime }));
  } else {
    const p = path.join(localDir, key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, buf);
  }
}

export async function readObject(key: string): Promise<Buffer | null> {
  if (key.includes("..")) return null;
  try {
    if (driver === "s3") {
      const r = await client().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
      return Buffer.from(await r.Body!.transformToByteArray());
    }
    return await fs.readFile(path.join(localDir, key));
  } catch {
    return null;
  }
}

export async function deleteObject(key: string) {
  try {
    if (driver === "s3") await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
    else await fs.unlink(path.join(localDir, key));
  } catch {}
}

export function mimeOf(key: string) {
  const e = key.split(".").pop()?.toLowerCase();
  const m: Record<string, string> = { pdf: "application/pdf", png: "image/png", webp: "image/webp", docx: DOCX, xlsx: XLSX, doc: "application/msword", xls: "application/vnd.ms-excel" };
  return m[e ?? ""] ?? "image/jpeg";
}

/** رابط عرض ملف عبر المنظومة (مع فحص الصلاحية) */
export const fileUrl = (key: string | null | undefined) => (key ? `/api/files/${key}` : null);

/** كل الملفات المخزنة (للنسخ الاحتياطي) */
export async function listObjects(): Promise<{ key: string; size: number }[]> {
  if (driver !== "s3") {
    const out: { key: string; size: number }[] = [];
    const walk = async (d: string) => {
      for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) await walk(f);
        else out.push({ key: path.relative(localDir, f).split(path.sep).join("/"), size: (await fs.stat(f)).size });
      }
    };
    await walk(localDir);
    return out;
  }
  const out: { key: string; size: number }[] = [];
  let token: string | undefined;
  do {
    const r = await client().send(new ListObjectsV2Command({ Bucket: bucket(), ContinuationToken: token }));
    for (const o of r.Contents ?? []) if (o.Key) out.push({ key: o.Key, size: o.Size ?? 0 });
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}
