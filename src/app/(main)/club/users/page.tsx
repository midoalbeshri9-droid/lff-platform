import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireClubUser } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/labels";
import { fmtDateTime } from "@/lib/util";
import { PageHead, Flash, Field, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { createClubUser, toggleClubUser } from "../actions";

export default async function ClubUsers({ searchParams }: { searchParams: SP }) {
  const u = await requireClubUser("club.view");
  const sp = await searchParams;
  const rows = await db.select().from(users).where(eq(users.clubId, u.clubId)).orderBy(users.id);
  const mgr = u.role === "CLUB_MANAGER";
  return (
    <>
      <PageHead title="مستخدمو النادي" sub="مدير الحساب يضيف موظفين لإدخال البيانات، أو حسابات اطلاع فقط" />
      <Flash sp={sp} />
      <div className="card table-wrap">
        <table className="t"><thead><tr><th>الاسم</th><th>اسم المستخدم</th><th>الدور</th><th>آخر دخول</th><th>الحالة</th><th></th></tr></thead>
          <tbody>{rows.map((x) => (
            <tr key={x.id}><td>{x.fullName}</td><td className="kbd">{x.username}</td><td>{ROLE_LABEL[x.role]}</td><td>{fmtDateTime(x.lastLoginAt)}</td>
              <td>{!x.isVerified ? <span className="b b-amber">بانتظار التفعيل</span> : x.isActive ? <span className="b b-green">نشط</span> : <span className="b b-gray">معطّل</span>}</td>
              <td>{mgr && x.id !== u.id && <form action={toggleClubUser}><input type="hidden" name="uid" value={x.id} /><Submit className="btn btn-sm btn-light">{x.isActive ? "تعطيل" : "تفعيل"}</Submit></form>}</td></tr>
          ))}</tbody></table>
      </div>
      {mgr && (
        <div className="card">
          <h2>إضافة مستخدم</h2>
          <form action={createClubUser} className="form">
            <Field label="الاسم الكامل"><input type="text" name="fullName" required /></Field>
            <Field label="اسم المستخدم (إنجليزي)"><input type="text" name="username" dir="ltr" required /></Field>
            <Field label="البريد الإلكتروني *" hint="يصله رابط التفعيل"><input type="email" name="email" dir="ltr" required placeholder="name@gmail.com" /></Field>
            <Field label="رقم الهاتف *"><input type="tel" name="phone" dir="ltr" required placeholder="0912345678" /></Field>
            <Field label="الدور"><select name="role"><option value="CLUB_EMPLOYEE">موظف (إدخال بيانات)</option><option value="CLUB_VIEWER">اطلاع فقط</option></select></Field>
            <div className="full"><Submit>إضافة</Submit></div>
          </form>
        </div>
      )}
    </>
  );
}
