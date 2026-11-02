import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { competitions, seasons, ageCategories, competitionTeams, matches } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getCurrentSeason } from "@/lib/registration";
import { COMP_TYPE, COMP_STATUS } from "@/lib/labels";
import { PageHead, Flash, Badge, Empty, Field, Options, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { saveCompetition } from "./actions";

export default async function Competitions({ searchParams }: { searchParams: SP }) {
  const u = await requireUser("comp.view");
  const sp = await searchParams;
  const cur = await getCurrentSeason();
  const [rows, ss, cats] = await Promise.all([
    db.select({ c: competitions, season: seasons.name, cat: ageCategories.name,
      teams: sql<number>`(select count(*)::int from ${competitionTeams} t where t.competition_id = "competitions"."id")`,
      played: sql<number>`(select count(*)::int from ${matches} m where m.competition_id = "competitions"."id" and m.report_status = 'APPROVED')`,
      total: sql<number>`(select count(*)::int from ${matches} m where m.competition_id = "competitions"."id")` })
      .from(competitions).innerJoin(seasons, eq(seasons.id, competitions.seasonId)).leftJoin(ageCategories, eq(ageCategories.id, competitions.categoryId))
      .orderBy(desc(seasons.startDate), competitions.name),
    db.select().from(seasons).orderBy(desc(seasons.startDate)),
    db.select().from(ageCategories).orderBy(ageCategories.sortOrder),
  ]);
  return (
    <>
      <PageHead title="المسابقات" />
      <Flash sp={sp} />
      <div className="card table-wrap">
        {rows.length === 0 ? <Empty>لا توجد مسابقات</Empty> : (
          <table className="t"><thead><tr><th>المسابقة</th><th>الموسم</th><th>النوع</th><th>الفئة</th><th>الفرق</th><th>المباريات</th><th>الحالة</th><th></th></tr></thead>
            <tbody>{rows.map(({ c, season, cat, teams, played, total }) => (
              <tr key={c.id}><td><strong>{c.name}</strong></td><td>{season}</td><td>{COMP_TYPE[c.type]}</td><td>{cat ?? "الفريق الأول"}</td>
                <td className="num">{teams}</td><td className="num">{played} / {total}</td><td><Badge v={COMP_STATUS[c.status]} /></td>
                <td><Link className="btn btn-sm btn-light" href={`/competitions/${c.id}`}>فتح</Link></td></tr>
            ))}</tbody></table>
        )}
      </div>
      {u.can("comp.manage") && (
        <details className="box card">
          <summary>+ مسابقة جديدة</summary>
          <form action={saveCompetition} className="form f3 mt">
            <Field label="الاسم"><input type="text" name="name" required placeholder="الدوري الليبي الممتاز" /></Field>
            <Field label="الموسم"><select name="seasonId" defaultValue={cur?.id}>{ss.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field label="النظام" hint="يمكن إضافة مراحل أخرى لاحقًا (مثل سداسي التتويج)"><select name="type"><Options map={COMP_TYPE} /></select></Field>
            <Field label="عدد المجموعات" hint="لأنظمة المجموعات"><input type="number" name="groupsCount" defaultValue={2} min={2} max={12} /></Field>
            <Field label="المتأهلون من كل مجموعة"><input type="number" name="qualifyPerGroup" defaultValue={2} min={1} /></Field>
            <Field label="خروج المغلوب"><select name="koLegs"><option value="1">مباراة واحدة</option><option value="2">ذهاب وإياب</option></select></Field>
            <Field label="الفئة العمرية" hint="تُمنع مشاركة لاعب من فئة أكبر"><select name="categoryId"><option value="">الفريق الأول (مفتوحة)</option>{cats.filter((c) => c.maxAge != null).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="أدوار الدوري/المجموعات (ذهاب/إياب)"><input type="number" name="legs" defaultValue={2} min={1} max={4} /></Field>
            <Field label="تاريخ البداية"><input type="date" name="startDate" /></Field>
            <Field label="نقاط الفوز"><input type="number" name="pointsWin" defaultValue={3} /></Field>
            <Field label="نقاط التعادل"><input type="number" name="pointsDraw" defaultValue={1} /></Field>
            <Field label="الأجانب في قائمة المباراة" hint="م70: الممتاز 3، الأولى 2، الثانية وما دونها والفئات 1"><input type="number" name="maxForeign" placeholder="بلا حد" /></Field>
            <Field label="الأجانب داخل الملعب معًا"><input type="number" name="maxForeignOnPitch" placeholder="بلا حد" /></Field>
            <Field label="قائمة الموسم (عدد)" hint="فارغ = غير مطلوبة"><input type="number" name="squadListMax" /></Field>
            <Field label="رسوم الاشتراك (د.ل)"><input type="number" step="0.01" name="entryFee" /></Field>
            <Field label="عدد لاعبي القائمة" hint="م65: 11 أساسيًا + 7 بدلاء"><input type="number" name="squadMax" defaultValue={18} /></Field>
            <Field label="التبديلات المسموحة" hint="م65: الكبار والشباب 3، الآمال 5"><input type="number" name="maxSubs" defaultValue={3} /></Field>
            <Field label="عدد الأساسيين"><input type="number" name="startersCount" defaultValue={11} /></Field>
            <Field label="تراكم الإنذارات = إيقاف"><input type="number" name="yellowThreshold" defaultValue={3} /></Field>
            <Field label="مباريات الإيقاف للطرد المباشر"><input type="number" name="redBanMatches" defaultValue={1} /></Field>
            <div className="full"><Submit>إنشاء المسابقة</Submit></div>
          </form>
        </details>
      )}
    </>
  );
}
