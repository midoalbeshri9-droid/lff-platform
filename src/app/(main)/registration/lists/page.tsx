import { desc, eq, and, sql } from "drizzle-orm";
import { db } from "@/db";
import { seasons, clubs, ageCategories, listTemplates, registrations } from "@/db/schema";
import { scopeOf, clubIn, regIn, guardPage, inScopeReg, inScopePlayer } from "@/lib/scope";
import { requireUser } from "@/lib/auth";
import { getCurrentSeason } from "@/lib/registration";
import { ROSTER_COLUMNS, DEFAULT_COLUMNS } from "@/lib/roster";
import { PageHead, Flash, Field, type SP } from "@/components/ui";
import { Submit, CheckAll } from "@/components/Client";
import { saveListTemplate, deleteListTemplate } from "../actions";

export default async function Lists({ searchParams }: { searchParams: SP }) {
  const u = await requireUser("reg.lists");
  const sc = await scopeOf(u);
  const sp = await searchParams;
  const cur = await getCurrentSeason();
  const [ss, cl, cats, tpls] = await Promise.all([
    db.select().from(seasons).orderBy(desc(seasons.startDate)),
    db.select({ id: clubs.id, name: clubs.name, n: sql<number>`(select count(*)::int from ${registrations} r where r.club_id = "clubs"."id" and r.season_id = ${cur?.id ?? 0} and r.status = 'APPROVED')` })
      .from(clubs).where(and(eq(clubs.isActive, true), clubIn(sc, clubs.id))).orderBy(clubs.name),
    db.select().from(ageCategories).where(and(eq(ageCategories.isActive, true))).orderBy(ageCategories.sortOrder),
    db.select().from(listTemplates).orderBy(listTemplates.name),
  ]);
  return (
    <>
      <PageHead title="قوائم الفرق" sub="استخراج قائمة اللاعبين المعتمدين لكل نادٍ بعد انتهاء فترة القيد — بالأعمدة التي تختارها" />
      <Flash sp={sp} />
      <form className="card" action="/print/roster" target="_blank">
        <div className="form f3">
          <Field label="الموسم"><select name="season" defaultValue={cur?.id}>{ss.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
          <Field label="الفئة العمرية"><select name="category"><option value="">كل الفئات</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="القالب"><select name="template"><option value="">الأعمدة المحددة أدناه</option>{tpls.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
        </div>
        <h3 className="mt">الأندية</h3>
        <CheckAll name="club" label="كل الأندية" />
        <div className="chk-grid mt">
          {cl.map((c) => <label key={c.id} className="check"><input type="checkbox" name="club" value={c.id} /> {c.name} <small className="muted">({c.n})</small></label>)}
        </div>
        <h3 className="mt">الأعمدة (عند عدم اختيار قالب)</h3>
        <div className="chk-grid">
          {ROSTER_COLUMNS.map((c) => <label key={c.key} className="check"><input type="checkbox" name="col" value={c.key} defaultChecked={DEFAULT_COLUMNS.includes(c.key)} /> {c.label}</label>)}
        </div>
        <div className="row mt">
          <label className="check"><input type="checkbox" name="landscape" value="1" /> طباعة أفقية</label>
          <label className="check"><input type="checkbox" name="stamp" value="1" /> إضافة الختم</label>
        </div>
        <div className="btn-row mt">
          <button className="btn btn-primary">🖨 عرض للطباعة / PDF</button>
          <button className="btn btn-light" formAction="/api/export/roster">⬇ تصدير Excel</button>
        </div>
        <p className="muted mt" style={{ fontSize: ".85rem" }}>لحفظ PDF: من نافذة الطباعة اختر «حفظ بصيغة PDF». كل نادٍ يُطبع في صفحة مستقلة.</p>
      </form>

      <div className="card">
        <h2>قوالب القوائم المحفوظة</h2>
        {[...tpls, null].map((t) => (
          <details key={t?.id ?? "new"} className="box">
            <summary>{t ? t.name : "+ قالب جديد"}</summary>
            <form action={saveListTemplate} className="stack mt">
              {t && <input type="hidden" name="id" value={t.id} />}
              <div className="form">
                <Field label="اسم القالب"><input type="text" name="name" defaultValue={t?.name} required /></Field>
                <Field label="عنوان القائمة المطبوع"><input type="text" name="title" defaultValue={t?.options?.title ?? "كشف اللاعبين المقيدين"} /></Field>
              </div>
              <div className="chk-grid">{ROSTER_COLUMNS.map((c) => <label key={c.key} className="check"><input type="checkbox" name="col" value={c.key} defaultChecked={(t?.columns ?? DEFAULT_COLUMNS).includes(c.key)} /> {c.label}</label>)}</div>
              <div className="row">
                <label className="check"><input type="checkbox" name="landscape" defaultChecked={t?.options?.landscape} /> أفقي</label>
                <label className="check"><input type="checkbox" name="showStamp" defaultChecked={t?.options?.showStamp} /> الختم</label>
              </div>
              <Field label="خانات التوقيع (سطر لكل خانة)"><textarea name="signatures" defaultValue={(t?.options?.signatures ?? ["رئيس لجنة القيد وأوضاع اللاعبين", "الأمين العام"]).join("\n")} /></Field>
              <div className="btn-row"><Submit className="btn btn-sm btn-primary">حفظ القالب</Submit></div>
            </form>
            {t && <form action={deleteListTemplate} className="mt"><input type="hidden" name="id" value={t.id} /><Submit className="btn btn-sm btn-ghost" confirm="حذف القالب؟">حذف</Submit></form>}
          </details>
        ))}
      </div>
    </>
  );
}
