import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clubs, divisions, seasons } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { scopeOf, clubIn } from "@/lib/scope";
import { PageHead } from "@/components/ui";
import { ClubImport } from "./ClubImport";

export default async function ImportClub() {
  const u = await requireUser("reg.edit");
  const sc = await scopeOf(u);
  const [season] = await db.select({ name: seasons.name }).from(seasons).where(eq(seasons.isCurrent, true));
  const cl = await db.select({ id: clubs.id, name: clubs.name }).from(clubs).where(and(eq(clubs.isActive, true), clubIn(sc, clubs.id))).orderBy(clubs.name);
  const dv = await db.select({ id: divisions.id, name: divisions.name }).from(divisions).where(eq(divisions.isActive, true)).orderBy(divisions.level);
  return (
    <>
      <PageHead title="استيراد نادٍ من Excel" sub={`ملف قائمة النادي (الصورة، رقم البطاقة، الاسم، تاريخ الميلاد، الجنسية، رقم القميص) ← النادي ولاعبوه وقيودهم المعتمدة وصورهم — الموسم ${season?.name ?? "—"}`}
        crumbs={[["سجل اللاعبين", "/registration/players"], ["استيراد نادٍ"]]} />
      {!season ? <div className="alert err">لا يوجد موسم حالي — حدّده من إعدادات القيد أولًا</div>
        : <ClubImport clubs={cl} divisions={dv} canCreate={u.can("admin.clubs") && !sc} fixedDivision={sc?.divisionId ?? null} />}
    </>
  );
}
