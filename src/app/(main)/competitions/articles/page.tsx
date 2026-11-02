import { db } from "@/db";
import { sanctionArticles, settings } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { SANCTION_TYPE } from "@/lib/labels";
import { money } from "@/lib/util";
import { PageHead, Flash, Field, Options, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { saveArticle, saveAppealDays } from "../sanctions/actions";

export default async function Articles({ searchParams }: { searchParams: SP }) {
  await requireUser("comp.articles");
  const sp = await searchParams;
  const rows = await db.select().from(sanctionArticles).orderBy(sanctionArticles.code);
  const [ad] = await db.select().from(settings).where(eq(settings.key, "appeal_days"));
  const form = (a?: (typeof rows)[number]) => (
    <form action={saveArticle} className="form f3 mt">
      {a && <input type="hidden" name="id" value={a.id} />}
      <Field label="رقم المادة *"><input type="text" name="code" defaultValue={a?.code} required /></Field>
      <Field label="العنوان *"><input type="text" name="title" defaultValue={a?.title} required /></Field>
      <Field label="تنطبق على"><select name="target" defaultValue={a?.target ?? "ANY"}><option value="ANY">الكل</option><option value="PLAYER">لاعب</option><option value="STAFF">إداري</option><option value="CLUB">نادٍ</option></select></Field>
      <Field label="العقوبة المقترحة"><select name="defaultType" defaultValue={a?.defaultType ?? ""}><option value="">—</option><Options map={SANCTION_TYPE} /></select></Field>
      <Field label="المباريات (من - إلى)"><div className="row"><input type="number" name="minMatches" defaultValue={a?.minMatches ?? ""} style={{ width: 80 }} /><input type="number" name="maxMatches" defaultValue={a?.maxMatches ?? ""} style={{ width: 80 }} /></div></Field>
      <Field label="الغرامة (من - إلى)"><div className="row"><input type="number" name="minFine" defaultValue={a?.minFine ?? ""} style={{ width: 100 }} /><input type="number" name="maxFine" defaultValue={a?.maxFine ?? ""} style={{ width: 100 }} /></div></Field>
      <Field label="نص المادة" full><textarea name="body" defaultValue={a?.body ?? ""} /></Field>
      <div className="full"><Submit>حفظ</Submit></div>
    </form>
  );
  return (
    <>
      <PageHead title="لائحة العقوبات" sub="أدخل مواد لائحة الانضباط المعتمدة — تظهر للاختيار عند إصدار القرارات" crumbs={[["العقوبات", "/competitions/sanctions"], ["اللائحة"]]} />
      <Flash sp={sp} />
      {rows.length === 0 && <div className="alert info">اللائحة فارغة حاليًا. يمكن إصدار القرارات بكتابة المادة يدويًا حتى تُدخل اللائحة.</div>}
      <form action={saveAppealDays} className="card row">
        <label>مهلة الطعن على القرارات (أيام):</label>
        <input type="number" name="appeal_days" defaultValue={ad?.value ?? "7"} style={{ width: 90 }} />
        <Submit className="btn btn-light btn-sm">حفظ</Submit>
      </form>
      {rows.map((a) => (
        <details key={a.id} className="box card">
          <summary>المادة {a.code}: {a.title} {a.defaultType && <span className="b b-gray">{SANCTION_TYPE[a.defaultType]}</span>}
            {(a.minFine || a.maxFine) && <small className="muted"> — غرامة {money(a.minFine)} ← {money(a.maxFine)}</small>}</summary>
          {form(a)}
        </details>
      ))}
      <details className="box card"><summary>+ إضافة مادة</summary>{form()}</details>
    </>
  );
}
