import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { clubs, clubCategories } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { scopeOf, clubIn } from "@/lib/scope";
import { CLUB_CATEGORY } from "@/lib/labels";
import { fmtDate, today } from "@/lib/util";
import { PageHead, Flash, Options, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { addClubCategory, deleteClubCategory } from "./actions";

/** تصنيف الأندية لحساب تعويضات التدريب والتضامن (لوائح الفيفا لأوضاع اللاعبين وانتقالاتهم) */
export default async function ClubCategories({ searchParams }: { searchParams: SP }) {
  const u = await requireUser("reg.view");
  const sp = await searchParams;
  const sc = await scopeOf(u);
  const cl = await db.select({ id: clubs.id, name: clubs.name }).from(clubs).where(and(eq(clubs.isActive, true), clubIn(sc, clubs.id))).orderBy(clubs.name);
  const recs = await db.select().from(clubCategories).orderBy(desc(clubCategories.validFrom));
  const t = today();
  const can = u.can("reg.edit");
  return (
    <>
      <PageHead title="تصنيف الأندية للتدريب" sub="سجل تاريخي لفئة كل نادٍ (1–4) يُستخدم في حساب تعويضات التدريب وفق لوائح الفيفا — كما في FIFA Connect" />
      <Flash sp={sp} />
      <div className="card table-wrap">
        <table className="t"><thead><tr><th>النادي</th><th>التصنيف الحالي</th><th>السجل</th>{can && <th>إضافة تصنيف</th>}</tr></thead>
          <tbody>{cl.map((c) => {
            const mine = recs.filter((r) => r.clubId === c.id);
            const cur = mine.find((r) => r.validFrom <= t);
            return (
              <tr key={c.id}><td><strong>{c.name}</strong></td>
                <td>{cur ? <span className="b b-green">{CLUB_CATEGORY[cur.category]}</span> : <span className="muted">غير مصنّف</span>}</td>
                <td style={{ fontSize: ".8rem" }}>{mine.map((r) => <div key={r.id}>{CLUB_CATEGORY[r.category]} — من {fmtDate(r.validFrom)}{r.notes ? ` (${r.notes})` : ""}
                  {can && <form action={deleteClubCategory} style={{ display: "inline" }}><input type="hidden" name="id" value={r.id} /><Submit className="btn btn-sm btn-ghost" confirm="حذف هذا التصنيف؟">×</Submit></form>}</div>)}</td>
                {can && <td><form action={addClubCategory} className="row" style={{ flexWrap: "nowrap", gap: 4 }}>
                  <input type="hidden" name="clubId" value={c.id} />
                  <select name="category" required style={{ width: 110 }}><Options map={CLUB_CATEGORY} /></select>
                  <input type="date" name="validFrom" defaultValue={t} required style={{ width: 140 }} />
                  <Submit className="btn btn-sm btn-light">حفظ</Submit></form></td>}
              </tr>);
          })}</tbody></table>
      </div>
    </>
  );
}
