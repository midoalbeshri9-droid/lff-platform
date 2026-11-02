import { desc } from "drizzle-orm";
import { db } from "@/db";
import { regulations } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { fmtDate } from "@/lib/util";
import { PageHead, Flash, Field, Empty, Options, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { saveRegulation, toggleRegulation } from "./actions";

const KIND: Record<string, string> = { COMPETITIONS: "تنظيم المسابقات", DISCIPLINE: "الانضباط والعقوبات", STATUS: "أوضاع وانتقالات اللاعبين", REFEREES: "الحكام", FINANCE: "المالية", OTHER: "أخرى" };

export default async function Regulations({ searchParams }: { searchParams: SP }) {
  const u = await requireUser();
  const sp = await searchParams;
  const manage = u.canAny("comp.articles", "admin.settings");
  const rows = (await db.select().from(regulations).orderBy(desc(regulations.approvedOn), desc(regulations.id))).filter((r) => manage || r.isActive);
  return (
    <>
      <PageHead title="اللوائح والقرارات" sub="لوائح الاتحاد المعتمدة — متاحة للجان والأندية والحكام" />
      <Flash sp={sp} />
      <div className="card table-wrap">
        {rows.length === 0 ? <Empty>لم تُرفع لوائح بعد</Empty> : (
          <table className="t"><thead><tr><th>اللائحة</th><th>المجال</th><th>تاريخ الاعتماد</th><th>ملاحظات</th><th></th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className={r.isActive ? "" : "muted"}>
                <td><strong>{r.title}</strong>{!r.isActive && <span className="b b-gray" style={{ marginInlineStart: 6 }}>غير منشورة</span>}</td>
                <td>{KIND[r.kind] ?? r.kind}</td><td>{fmtDate(r.approvedOn)}</td><td>{r.notes}</td>
                <td className="row">
                  <a className="btn btn-sm btn-light" href={`/api/files/${r.fileKey}`} target="_blank">📄 فتح</a>
                  {manage && <form action={toggleRegulation}><input type="hidden" name="id" value={r.id} /><Submit className="btn btn-sm btn-ghost">{r.isActive ? "إخفاء" : "نشر"}</Submit></form>}
                </td>
              </tr>
            ))}</tbody></table>
        )}
      </div>
      {manage && (
        <details className="card">
          <summary>+ رفع لائحة</summary>
          <form action={saveRegulation} className="form f3 mt">
            <Field label="العنوان *"><input type="text" name="title" required placeholder="لائحة تنظيم المسابقات" /></Field>
            <Field label="المجال"><select name="kind"><Options map={KIND} /></select></Field>
            <Field label="تاريخ الاعتماد"><input type="date" name="approvedOn" /></Field>
            <Field label="ملف PDF *"><input type="file" name="file" accept="application/pdf" required /></Field>
            <Field label="ملاحظات" full><input type="text" name="notes" /></Field>
            <div className="full"><Submit>رفع</Submit></div>
          </form>
        </details>
      )}
    </>
  );
}
