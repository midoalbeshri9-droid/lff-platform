"use server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { archiveDocs, archiveVersions } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { saveUpload, ALLOWED_ARCHIVE } from "@/lib/storage";
import { nextSerial } from "@/lib/secretariat";
import { canSeeDoc } from "@/lib/archive";
import { attempt, str, req, int, UserError } from "@/lib/util";

const MAX = 12 * 1024 * 1024;
function meta(f: FormData) {
  const confidentiality = ["GENERAL", "COMMITTEE", "SECRET"].includes(str(f, "confidentiality") ?? "") ? str(f, "confidentiality")! : "GENERAL";
  const committee = str(f, "committee");
  if (confidentiality === "COMMITTEE" && !committee) throw new UserError("حدد اللجنة للوثيقة الخاصة باللجنة");
  return {
    category: str(f, "category") ?? "OTHER", committee, docDate: str(f, "docDate"), refNumber: str(f, "refNumber"), description: str(f, "description"),
    tags: str(f, "tags"), confidentiality, clubId: int(f, "clubId"), playerId: int(f, "playerId"), matchId: int(f, "matchId"),
    officialId: int(f, "officialId"), competitionId: int(f, "competitionId"), seasonId: int(f, "seasonId"),
    physicalLocation: str(f, "physicalLocation"), retentionUntil: str(f, "retentionUntil"),
  };
}

/** رفع وثيقة أو عدة وثائق (أرشفة دفعة واحدة) بالبيانات نفسها */
export async function uploadDocs(f: FormData) {
  const u = await requireUser("archive.manage");
  let firstId: number | null = null;
  await attempt(() => (firstId ? `/archive/${firstId}` : "/archive"), async () => {
    const files = (f.getAll("files") as File[]).filter((x) => x && x.size);
    if (!files.length) throw new UserError("اختر ملفًا واحدًا على الأقل");
    if (files.length > 30) throw new UserError("الحد الأقصى 30 ملفًا في المرة الواحدة");
    if (meta(f).confidentiality === "SECRET" && !u.can("archive.secret")) throw new UserError("لا تملك صلاحية إضافة وثائق سرية");
    const base = meta(f);
    const title = str(f, "title");
    if (files.length === 1 && !title) throw new UserError("عنوان الوثيقة مطلوب");
    const numbers: string[] = [], dups: string[] = [];
    for (const file of files) {
      const up = await saveUpload(file, "archive", ALLOWED_ARCHIVE, MAX);
      const [dup] = await db.select({ n: archiveDocs.number }).from(archiveDocs).where(and(eq(archiveDocs.hash, up.hash), eq(archiveDocs.isDeleted, false)));
      if (dup) dups.push(`${file.name} (مكرر مع ${dup.n})`);
      const number = await nextSerial("أر", Number((base.docDate ?? new Date().toISOString()).slice(0, 4)));
      const name = file.name.replace(/\.[^.]+$/, "");
      const [row] = await db.insert(archiveDocs).values({
        ...base, number, title: files.length === 1 ? title! : title ? `${title} — ${name}` : name,
        fileKey: up.key, fileName: up.name, mime: up.mime, size: up.size, hash: up.hash, createdBy: u.fullName,
      }).returning();
      firstId ??= row.id;
      numbers.push(number);
    }
    if (files.length > 1) firstId = null;
    await audit(u, "أرشفة وثائق", "ArchiveDoc", null, { count: numbers.length, numbers });
    return `تمت أرشفة ${numbers.length} وثيقة${numbers.length === 1 ? ` برقم ${numbers[0]}` : ""}${dups.length ? ` — تنبيه: ملفات مؤرشفة سابقًا: ${dups.join("، ")}` : ""}`;
  });
}

export async function updateDoc(f: FormData) {
  const u = await requireUser("archive.manage");
  const id = int(f, "id")!;
  await attempt(`/archive/${id}`, async () => {
    const [d] = await db.select().from(archiveDocs).where(eq(archiveDocs.id, id));
    if (!d || !canSeeDoc(u, d)) throw new UserError("الوثيقة غير متاحة");
    const data = { ...meta(f), title: req(f, "title", "العنوان"), updatedAt: new Date() };
    if (data.confidentiality === "SECRET" && !u.can("archive.secret")) throw new UserError("لا تملك صلاحية تصنيف الوثيقة سرية");
    const file = f.get("file") as File | null;
    if (file && file.size) {
      const up = await saveUpload(file, "archive", ALLOWED_ARCHIVE, MAX);
      await db.insert(archiveVersions).values({ docId: id, fileKey: d.fileKey, fileName: d.fileName, replacedBy: u.fullName, note: str(f, "versionNote") });
      Object.assign(data, { fileKey: up.key, fileName: up.name, mime: up.mime, size: up.size, hash: up.hash });
    }
    await db.update(archiveDocs).set(data).where(eq(archiveDocs.id, id));
    await audit(u, file && file.size ? "استبدال ملف وثيقة" : "تعديل بيانات وثيقة", "ArchiveDoc", id, d.number);
    return file && file.size ? "تم استبدال الملف وحُفظت النسخة السابقة" : "تم الحفظ";
  });
}

export async function deleteDoc(f: FormData) {
  const u = await requireUser("archive.manage");
  const id = int(f, "id")!;
  await attempt("/archive", async () => {
    const reason = req(f, "reason", "سبب الحذف");
    const [d] = await db.select().from(archiveDocs).where(eq(archiveDocs.id, id));
    if (!d || !canSeeDoc(u, d)) throw new UserError("الوثيقة غير متاحة");
    await db.update(archiveDocs).set({ isDeleted: true, updatedAt: new Date(), description: `${d.description ?? ""}\n[حُذفت: ${reason}]` }).where(eq(archiveDocs.id, id));
    await audit(u, "حذف وثيقة من الأرشيف", "ArchiveDoc", id, { number: d.number, reason });
    return `حُذفت الوثيقة ${d.number} (يمكن لصاحب صلاحية الوثائق السرية استعادتها)`;
  });
}

export async function restoreDoc(f: FormData) {
  const u = await requireUser("archive.secret");
  const id = int(f, "id")!;
  await attempt(`/archive/${id}`, async () => {
    await db.update(archiveDocs).set({ isDeleted: false, updatedAt: new Date() }).where(eq(archiveDocs.id, id));
    await audit(u, "استعادة وثيقة محذوفة", "ArchiveDoc", id);
    return "استُعيدت الوثيقة";
  });
}
