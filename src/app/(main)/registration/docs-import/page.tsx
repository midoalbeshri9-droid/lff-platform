import { and, eq, asc } from "drizzle-orm";
import { db } from "@/db";
import { documentTypes } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { PageHead } from "@/components/ui";
import { PlayerFilesUploader } from "@/components/PlayerFilesUploader";

export default async function DocsImport() {
  await requireUser("reg.edit");
  const types = await db.select({ id: documentTypes.id, name: documentTypes.name }).from(documentTypes).where(and(eq(documentTypes.isActive, true), eq(documentTypes.scope, "PLAYER"))).orderBy(asc(documentTypes.sortOrder));
  return (
    <>
      <PageHead title="رفع ملفات اللاعبين بالجملة" sub="اختر مجلدًا فيه مجلد لكل لاعب (الصورة، الجواز، العقد، الكشف الطبي، ITC...) — اسم المجلد رقم البطاقة أو اسم اللاعب"
        crumbs={[["سجل اللاعبين", "/registration/players"], ["رفع الملفات"]]} />
      <div className="card"><PlayerFilesUploader types={types} /></div>
    </>
  );
}
