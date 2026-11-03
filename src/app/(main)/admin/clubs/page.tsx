import { and, eq, sql, isNull } from "drizzle-orm";
import { db } from "@/db";
import { clubs, users, registrations, divisions } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getCurrentSeason } from "@/lib/registration";
import { PageHead, Flash, Field, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { saveClub, createClubManager } from "../actions";

const REGIONS = ["المنطقة الشرقية", "المنطقة الغربية", "المنطقة الجنوبية", "المنطقة الوسطى"];

export default async function Clubs({ searchParams }: { searchParams: SP }) {
  const u = await requireUser("admin.clubs");
  const sp = await searchParams;
  const cur = await getCurrentSeason();
  const rows = await db.select({
    c: clubs,
    accounts: sql<number>`(select count(*)::int from ${users} x where x.club_id = "clubs"."id")`,
    players: sql<number>`(select count(*)::int from ${registrations} r where r.club_id = "clubs"."id" and r.season_id = ${cur?.id ?? 0} and r.status = 'APPROVED')`,
  }).from(clubs).where(and(
    sp.division === "none" ? isNull(clubs.divisionId) : sp.division ? eq(clubs.divisionId, Number(sp.division)) : undefined,
    sp.region === "none" ? isNull(clubs.region) : sp.region ? eq(clubs.region, String(sp.region)) : undefined,
  )).orderBy(clubs.region, clubs.name);
  const dv = await db.select().from(divisions).orderBy(divisions.level);
  const used = await db.selectDistinct({ r: clubs.region }).from(clubs);
  const regions = [...new Set([...REGIONS, ...used.map((x) => x.r).filter((x): x is string => !!x)])];
  const fields = (c?: typeof clubs.$inferSelect) => (
    <>
      {c && <input type="hidden" name="id" value={c.id} />}
      <Field label="اسم النادي"><input type="text" name="name" defaultValue={c?.name} required /></Field>
      <Field label="الاسم بالإنجليزية"><input type="text" name="nameEn" dir="ltr" defaultValue={c?.nameEn ?? ""} /></Field>
      <Field label="الاسم المختصر"><input type="text" name="shortName" defaultValue={c?.shortName ?? ""} /></Field>
      <Field label="الرمز"><input type="text" name="code" dir="ltr" defaultValue={c?.code ?? ""} /></Field>
      <Field label="المدينة"><input type="text" name="city" defaultValue={c?.city ?? ""} /></Field>
      <Field label="الدرجة"><select name="divisionId" defaultValue={c?.divisionId ?? ""}><option value="">— غير مصنف —</option>{dv.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
      <Field label="المنطقة" hint="اختر من القائمة أو اكتب منطقة جديدة"><input type="text" name="region" list="regions" defaultValue={c?.region ?? ""} /></Field>
      <input type="hidden" name="stadium" defaultValue={c?.stadium ?? ""} />
      <Field label="الهاتف"><input type="text" name="phone" dir="ltr" defaultValue={c?.phone ?? ""} /></Field>
      <Field label="البريد"><input type="email" name="email" dir="ltr" defaultValue={c?.email ?? ""} /></Field>
      <Field label="الشعار"><input type="file" name="logo" accept="image/*" /></Field>
      {c && <Field label="نشط"><label className="check"><input type="checkbox" name="isActive" defaultChecked={c.isActive} /> نشط</label></Field>}
    </>
  );
  return (
    <>
      <PageHead title="الأندية" sub={`${rows.length} نادٍ`} />
      <Flash sp={sp} />
      <datalist id="regions">{regions.map((r) => <option key={r} value={r} />)}</datalist>
      <form className="card row" method="get">
        <Field label="الدرجة"><select name="division" defaultValue={String(sp.division ?? "")}><option value="">الكل</option>{dv.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}<option value="none">غير مصنف</option></select></Field>
        <Field label="المنطقة"><select name="region" defaultValue={String(sp.region ?? "")}><option value="">الكل</option>{regions.map((r) => <option key={r} value={r}>{r}</option>)}<option value="none">بلا منطقة</option></select></Field>
        <button className="btn btn-light" style={{ alignSelf: "end" }}>تصفية</button>
      </form>
      <details className="box card"><summary>+ نادٍ جديد</summary><form action={saveClub} className="form f3 mt">{fields()}<div className="full"><Submit>إضافة</Submit></div></form></details>
      <div className="card table-wrap">
        <table className="t"><thead><tr><th>النادي</th><th>المدينة</th><th>المنطقة</th><th>الدرجة</th><th>الملعب</th><th>لاعبون معتمدون</th><th>حسابات</th><th>الحالة</th><th></th></tr></thead>
          <tbody>{rows.map(({ c, accounts, players }) => (
            <tr key={c.id}><td><strong>{c.name}</strong><div className="muted kbd" style={{ fontSize: ".8rem" }}>{c.nameEn}</div></td><td>{c.city}</td><td>{c.region ?? <span className="muted">—</span>}</td><td>{dv.find((d) => d.id === c.divisionId)?.name ?? <span className="muted">—</span>}</td><td>{c.stadium ?? <a href="/competitions/stadiums#clubs" className="muted">لم يُحدد</a>}</td>
              <td className="num">{players}</td><td className="num">{accounts || <span className="b b-amber">بلا حساب</span>}</td>
              <td>{c.isActive ? <span className="b b-green">نشط</span> : <span className="b b-gray">غير نشط</span>}</td>
              <td><details><summary className="btn btn-sm btn-light">إدارة</summary>
                <div style={{ minWidth: 340 }}>
                  <form action={saveClub} className="form f1 mt">{fields(c)}<Submit>حفظ</Submit></form>
                  {u.can("admin.users") && (
                    <form action={createClubManager} className="stack mt">
                      <strong>إنشاء حساب مدير النادي</strong>
                      <input type="hidden" name="clubId" value={c.id} />
                      <input type="text" name="fullName" placeholder="اسم المسؤول" />
                      <input type="text" name="username" dir="ltr" placeholder="اسم المستخدم" required />
                      <input type="email" name="email" dir="ltr" placeholder="البريد (يصله رابط التفعيل)" required />
                      <input type="tel" name="phone" dir="ltr" placeholder="الهاتف 09xxxxxxxx" required />
                      <Submit className="btn btn-gold btn-sm">إنشاء الحساب</Submit>
                    </form>
                  )}
                </div></details></td></tr>
          ))}</tbody></table>
      </div>
    </>
  );
}
