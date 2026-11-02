import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { seasons, ageCategories } from "@/db/schema";
import { requireClubUser } from "@/lib/auth";
import { getCurrentSeason } from "@/lib/registration";
import { PageHead } from "@/components/ui";

export default async function ClubRoster() {
  const u = await requireClubUser("club.view");
  const cur = await getCurrentSeason();
  const ss = await db.select().from(seasons).orderBy(desc(seasons.startDate));
  const cats = await db.select().from(ageCategories).orderBy(ageCategories.sortOrder);
  return (
    <>
      <PageHead title="قائمة الفريق المعتمدة" sub="القائمة الرسمية للاعبين المعتمدين من لجنة القيد — للطباعة أو التصدير" />
      <form className="card form" action="/print/roster" target="_blank">
        <input type="hidden" name="club" value={u.clubId} />
        <div className="field"><label>الموسم</label><select name="season" defaultValue={cur?.id}>{ss.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div className="field"><label>الفئة</label><select name="category"><option value="">كل الفئات</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="btn-row full">
          <button className="btn btn-primary">🖨 عرض وطباعة</button>
          <button className="btn btn-light" formAction="/api/export/roster">⬇ Excel</button>
        </div>
      </form>
      <p className="muted">القائمة تحمل ترويسة الاتحاد. للقائمة المختومة رسميًا تواصل مع لجنة القيد. <Link href="/club/players">عرض اللاعبين</Link></p>
    </>
  );
}
