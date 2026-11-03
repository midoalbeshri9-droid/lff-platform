import { requireUser } from "@/lib/auth";
import { PageHead } from "@/components/ui";
import { PhotoImport } from "./PhotoImport";

export default async function PhotosImport() {
  await requireUser("reg.edit");
  return (
    <>
      <PageHead title="استيراد صور اللاعبين من Excel" sub="ملف Excel فيه صورة كل لاعب في صفّه مع رقم البطاقة — تُطابق الصور برقم البطاقة قبل الحفظ"
        crumbs={[["سجل اللاعبين", "/registration/players"], ["استيراد الصور"]]} />
      <PhotoImport />
    </>
  );
}
