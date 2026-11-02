import { requireClubUser } from "@/lib/auth";
import { IMPORT_COLS } from "@/lib/importCols";
import { PageHead, Flash, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { importPlayers } from "../actions";

export default async function Import({ searchParams }: { searchParams: SP }) {
  await requireClubUser("club.edit");
  const sp = await searchParams;
  return (
    <>
      <PageHead title="استيراد لاعبين من Excel" sub="لإدخال لاعبين جدد دفعة واحدة — كل صف يصبح طلب قيد جديد كمسودة" crumbs={[["لاعبو النادي", "/club/players"], ["استيراد"]]} />
      <Flash sp={sp} />
      <div className="card">
        <h3>1) نزّل النموذج واملأه</h3>
        <a className="btn btn-light" href="/api/import/template">⬇ نموذج Excel</a>
        <p className="muted mt">الأعمدة: {IMPORT_COLS.join(" — ")}</p>
        <p className="muted">اللاعبون المسجلون مسبقًا (بنفس الرقم الوطني) يُتخطّون — أنشئ لهم طلب تجديد أو انتقال من «إضافة لاعب».</p>
      </div>
      <form action={importPlayers} className="card">
        <h3>2) ارفع الملف</h3>
        <input type="file" name="file" accept=".xlsx" required />
        <div className="mt"><Submit>⬆ استيراد</Submit></div>
      </form>
    </>
  );
}
