"use server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { regulations } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { saveUpload } from "@/lib/storage";
import { attempt, str, req, int, UserError } from "@/lib/util";

export async function saveRegulation(f: FormData) {
  const u = await requireUser("comp.articles", "admin.settings");
  await attempt("/regulations", async () => {
    const id = int(f, "id");
    const file = f.get("file") as File | null;
    if (!id && !(file && file.size)) throw new UserError("اختر ملف اللائحة (PDF)");
    const up = file && file.size ? await saveUpload(file, "regulations", ["application/pdf"]) : null;
    const data = {
      title: req(f, "title", "عنوان اللائحة"), kind: str(f, "kind") ?? "OTHER", approvedOn: str(f, "approvedOn"), notes: str(f, "notes"),
      ...(up ? { fileKey: up.key, fileName: up.name } : {}),
    };
    if (id) await db.update(regulations).set(data).where(eq(regulations.id, id));
    else await db.insert(regulations).values({ ...data, fileKey: up!.key, createdBy: u.fullName });
    await audit(u, id ? "تعديل لائحة" : "رفع لائحة", "Regulation", id, data.title);
    return "تم حفظ اللائحة";
  });
}

export async function toggleRegulation(f: FormData) {
  const u = await requireUser("comp.articles", "admin.settings");
  await attempt("/regulations", async () => {
    const id = int(f, "id")!;
    const [r] = await db.select().from(regulations).where(eq(regulations.id, id));
    await db.update(regulations).set({ isActive: !r.isActive }).where(eq(regulations.id, id));
    await audit(u, r.isActive ? "إلغاء نشر لائحة" : "نشر لائحة", "Regulation", id, r.title);
    return r.isActive ? "أُخفيت اللائحة" : "نُشرت اللائحة";
  });
}
