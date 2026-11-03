import { eq, sql, ne } from "drizzle-orm";
import { db } from "@/db";
import { clubs, users, registrations, stadiums } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { divContext } from "@/lib/division";
import { getCurrentSeason } from "@/lib/registration";
import { PageHead, Flash, Field, Empty, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { DivNav } from "../DivNav";
import { saveDivClub, toggleDivClub } from "../actions";

const REGIONS = ["المنطقة الشرقية", "المنطقة الغربية", "المنطقة الجنوبية", "المنطقة الوسطى"];

export default async function DivisionClubs({ searchParams }: { searchParams: SP }) {
  const u = await requireUser("div.clubs");
  const sp = await searchParams;
  const d = await divContext(u, Number(sp.d) || null);
  if (!d) return (<><PageHead title="أندية الدرجة" sub="اختر الدرجة لإدارتها" /><DivNav u={u} d={null} active="clubs" /></>);
  const cur = await getCurrentSeason();
  const rows = await db.select({
    c: clubs,
    accounts: sql<number>`(select count(*)::int from ${users} x where x.club_id = "clubs"."id" and x.is_active)`,
    players: sql<number>`(select count(*)::int from ${registrations} r where r.club_id = "clubs"."id" and r.season_id = ${cur?.id ?? 0} and r.status = 'APPROVED')`,
  }).from(clubs).where(eq(clubs.divisionId, d.id)).orderBy(clubs.region, clubs.name);
  rows.sort((a, b) => Number(b.c.isActive) - Number(a.c.isActive));
  const st = await db.select({ id: stadiums.id, name: stadiums.name, city: stadiums.city }).from(stadiums).where(ne(stadiums.status, "CLOSED")).orderBy(stadiums.name);
  const regions = [...new Set([...REGIONS, ...rows.map((r) => r.c.region).filter((x): x is string => !!x)])];
  const fields = (c?: typeof clubs.$inferSelect) => (
    <>
      <input type="hidden" name="d" value={d.id} />
      {c && <input type="hidden" name="id" value={c.id} />}
      <Field label="اسم النادي *"><input type="text" name="name" defaultValue={c?.name} required /></Field>
      <Field label="الاسم بالإنجليزية"><input type="text" name="nameEn" dir="ltr" defaultValue={c?.nameEn ?? ""} /></Field>
      <Field label="الاسم المختصر"><input type="text" name="shortName" defaultValue={c?.shortName ?? ""} /></Field>
      <Field label="الرمز"><input type="text" name="code" dir="ltr" defaultValue={c?.code ?? ""} /></Field>
      <Field label="المدينة"><input type="text" name="city" defaultValue={c?.city ?? ""} /></Field>
      <Field label="المنطقة"><input type="text" name="region" list="regions" defaultValue={c?.region ?? ""} /></Field>
      <Field label="الهاتف"><input type="text" name="phone" dir="ltr" defaultValue={c?.phone ?? ""} /></Field>
      <Field label="البريد"><input type="email" name="email" dir="ltr" defaultValue={c?.email ?? ""} /></Field>
      <Field label="الملعب الأساسي"><select name="mainStadiumId" defaultValue={c?.mainStadiumId ?? ""}><option value="">—</option>{st.map((s) => <option key={s.id} value={s.id}>{s.name}{s.city ? ` — ${s.city}` : ""}</option>)}</select></Field>
      <Field label="الملعب الاحتياطي"><select name="backupStadiumId" defaultValue={c?.backupStadiumId ?? ""}><option value="">—</option>{st.map((s) => <option key={s.id} value={s.id}>{s.name}{s.city ? ` — ${s.city}` : ""}</option>)}</select></Field>
      <Field label="الشعار"><input type="file" name="logo" accept="image/*" /></Field>
    </>
  );
  const active = rows.filter((r) => r.c.isActive).length;
  return (
    <>
      <PageHead title={`أندية ${d.name}`} sub={`${active} نادٍ نشط${rows.length > active ? ` — ${rows.length - active} معطّل` : ""} — الملعب غير الموجود في القائمة يُضاف من «سجل الملاعب»`} />
      <DivNav u={u} d={d} active="clubs" />
      <Flash sp={sp} />
      <datalist id="regions">{regions.map((r) => <option key={r} value={r} />)}</datalist>
      <details className="box card" open={rows.length === 0}><summary>+ نادٍ جديد في {d.name}</summary>
        <form action={saveDivClub} className="form f3 mt">{fields()}<div className="full"><Submit>إضافة النادي</Submit></div></form>
      </details>
      <div className="card table-wrap">
        {rows.length === 0 ? <Empty>لا أندية في هذه الدرجة بعد</Empty> : (
          <table className="t"><thead><tr><th>النادي</th><th>المدينة</th><th>المنطقة</th><th>الملعب الأساسي</th><th className="num">لاعبون معتمدون</th><th className="num">حسابات نشطة</th><th>الحالة</th><th></th></tr></thead>
            <tbody>{rows.map(({ c, accounts, players }) => (
              <tr key={c.id} className={c.isActive ? "" : "muted"}>
                <td><strong>{c.name}</strong><div className="muted kbd" style={{ fontSize: ".8rem" }}>{c.nameEn}</div></td>
                <td>{c.city ?? "—"}</td><td>{c.region ?? "—"}</td><td>{c.stadium ?? <span className="muted">لم يُحدد</span>}</td>
                <td className="num">{players}</td><td className="num">{accounts || <span className="b b-amber">بلا حساب</span>}</td>
                <td>{c.isActive ? <span className="b b-green">نشط</span> : <span className="b b-gray">معطّل</span>}</td>
                <td><details><summary className="btn btn-sm btn-light">إدارة</summary>
                  <div style={{ minWidth: 340 }}>
                    <form action={saveDivClub} className="form f1 mt">{fields(c)}<Submit>حفظ</Submit></form>
                    <form action={toggleDivClub} className="mt"><input type="hidden" name="d" value={d.id} /><input type="hidden" name="id" value={c.id} />
                      <Submit className={`btn btn-sm ${c.isActive ? "btn-danger" : "btn-light"}`} confirm={c.isActive ? `تعطيل ${c.name} وكل حساباته؟ (لا يُحذف شيء من بياناته)` : `إعادة تفعيل ${c.name}؟`}>{c.isActive ? "تعطيل النادي" : "إعادة التفعيل"}</Submit>
                    </form>
                  </div></details></td>
              </tr>))}</tbody></table>
        )}
      </div>
    </>
  );
}
