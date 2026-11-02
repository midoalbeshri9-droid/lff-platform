import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { clubs, users, registrations } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getCurrentSeason } from "@/lib/registration";
import { PageHead, Flash, Field, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { saveClub, createClubManager } from "../actions";

export default async function Clubs({ searchParams }: { searchParams: SP }) {
  const u = await requireUser("admin.clubs");
  const sp = await searchParams;
  const cur = await getCurrentSeason();
  const rows = await db.select({
    c: clubs,
    accounts: sql<number>`(select count(*)::int from ${users} x where x.club_id = "clubs"."id")`,
    players: sql<number>`(select count(*)::int from ${registrations} r where r.club_id = "clubs"."id" and r.season_id = ${cur?.id ?? 0} and r.status = 'APPROVED')`,
  }).from(clubs).orderBy(clubs.name);
  const fields = (c?: typeof clubs.$inferSelect) => (
    <>
      {c && <input type="hidden" name="id" value={c.id} />}
      <Field label="اسم النادي"><input type="text" name="name" defaultValue={c?.name} required /></Field>
      <Field label="الاسم بالإنجليزية"><input type="text" name="nameEn" dir="ltr" defaultValue={c?.nameEn ?? ""} /></Field>
      <Field label="الاسم المختصر"><input type="text" name="shortName" defaultValue={c?.shortName ?? ""} /></Field>
      <Field label="الرمز"><input type="text" name="code" dir="ltr" defaultValue={c?.code ?? ""} /></Field>
      <Field label="المدينة"><input type="text" name="city" defaultValue={c?.city ?? ""} /></Field>
      <Field label="المنطقة"><input type="text" name="region" defaultValue={c?.region ?? ""} /></Field>
      <Field label="الملعب"><input type="text" name="stadium" defaultValue={c?.stadium ?? ""} /></Field>
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
      <details className="box card"><summary>+ نادٍ جديد</summary><form action={saveClub} className="form f3 mt">{fields()}<div className="full"><Submit>إضافة</Submit></div></form></details>
      <div className="card table-wrap">
        <table className="t"><thead><tr><th>النادي</th><th>المدينة</th><th>الملعب</th><th>لاعبون معتمدون</th><th>حسابات</th><th>الحالة</th><th></th></tr></thead>
          <tbody>{rows.map(({ c, accounts, players }) => (
            <tr key={c.id}><td><strong>{c.name}</strong><div className="muted kbd" style={{ fontSize: ".8rem" }}>{c.nameEn}</div></td><td>{c.city}</td><td>{c.stadium}</td>
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
