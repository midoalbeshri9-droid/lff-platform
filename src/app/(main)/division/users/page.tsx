import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { users, clubs, officials } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { divContext, divUsersWhere, grantable, DIV_CREATABLE } from "@/lib/division";
import { ROLE_LABEL } from "@/lib/labels";
import { PageHead, Flash, Field, Empty, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { DivNav } from "../DivNav";
import { saveDivUser, divUserAction } from "../actions";

export default async function DivisionUsers({ searchParams }: { searchParams: SP }) {
  const u = await requireUser("div.users");
  const sp = await searchParams;
  const d = await divContext(u, Number(sp.d) || null);
  if (!d) return (<><PageHead title="حسابات الدرجة" sub="اختر الدرجة لإدارتها" /><DivNav u={u} d={null} active="users" /></>);
  const where = await divUsersWhere(d.id);
  const rows = await db.select({ u: users, club: clubs.name, official: officials.fullName }).from(users)
    .leftJoin(clubs, eq(clubs.id, users.clubId)).leftJoin(officials, eq(officials.id, users.officialId))
    .where(where).orderBy(users.role, clubs.name, users.fullName);
  const cl = await db.select({ id: clubs.id, name: clubs.name }).from(clubs).where(and(eq(clubs.divisionId, d.id), eq(clubs.isActive, true))).orderBy(clubs.name);
  const taken = new Set(rows.map((r) => r.u.officialId).filter(Boolean));
  const offs = await db.select({ id: officials.id, name: officials.fullName, type: officials.type }).from(officials).where(eq(officials.divisionId, d.id)).orderBy(officials.fullName);
  const perms = grantable(u);
  const groups = [...new Set(perms.map((p) => p.group))];
  const roles = d.admin ? [...DIV_CREATABLE, "DIV_MANAGER" as const] : DIV_CREATABLE;
  const editable = (t: typeof users.$inferSelect) => t.role !== "ADMIN" && (d.admin || (t.id !== u.id && t.role !== "DIV_MANAGER" && (!t.divisionId || t.role === "DIV_STAFF")));
  const PermBoxes = ({ chosen }: { chosen?: string[] | null }) => (
    <div className="full">
      <label>صلاحيات موظف الدرجة <span className="muted">(تظهر لموظف الدرجة فقط — من صلاحياتك أنت)</span></label>
      {groups.map((g) => (
        <fieldset key={g} className="box" style={{ margin: ".3rem 0", padding: ".4rem .7rem" }}>
          <legend style={{ fontSize: ".85rem" }}>{g}</legend>
          <div className="chk-grid">{perms.filter((p) => p.group === g).map((p) => (
            <label key={p.k} className="check" style={{ fontSize: ".85rem" }}><input type="checkbox" name="perm" value={p.k} defaultChecked={chosen?.includes(p.k)} /> {p.label}</label>
          ))}</div>
        </fieldset>
      ))}
    </div>
  );
  const fields = (t?: typeof users.$inferSelect) => (
    <>
      <input type="hidden" name="d" value={d.id} />
      {t && <input type="hidden" name="id" value={t.id} />}
      <Field label="نوع الحساب *"><select name="role" defaultValue={t?.role ?? "CLUB_MANAGER"} required>{roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></Field>
      <Field label="الاسم *"><input type="text" name="fullName" defaultValue={t?.fullName} required /></Field>
      {!t && <Field label="اسم المستخدم *" hint="حروف إنجليزية صغيرة وأرقام"><input type="text" name="username" dir="ltr" required /></Field>}
      <Field label="البريد *" hint="يصله رابط التفعيل"><input type="email" name="email" dir="ltr" defaultValue={t?.email ?? ""} required /></Field>
      <Field label="الهاتف *"><input type="tel" name="phone" dir="ltr" defaultValue={t?.phone ?? ""} required placeholder="09xxxxxxxx" /></Field>
      <Field label="النادي" hint="لحسابات الأندية"><select name="clubId" defaultValue={t?.clubId ?? ""}><option value="">—</option>{cl.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="الحكم / المراقب" hint="لحسابات الحكام والمراقبين"><select name="officialId" defaultValue={t?.officialId ?? ""}><option value="">—</option>
        {offs.filter((o) => !taken.has(o.id) || o.id === t?.officialId).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
      <PermBoxes chosen={t?.customPerms} />
    </>
  );
  const status = (t: typeof users.$inferSelect) => !t.isActive ? <span className="b b-gray">معطّل</span> : !t.isVerified ? <span className="b b-amber">بانتظار التفعيل</span> : <span className="b b-green">نشط</span>;
  const permLabel = new Map(perms.map((p) => [p.k, p.label]));
  return (
    <>
      <PageHead title={`حسابات ${d.name}`} sub="حسابات الأندية والحكام وموظفي الدرجة — كل حساب يرى ما يخص الدرجة فقط" />
      <DivNav u={u} d={d} active="users" />
      <Flash sp={sp} />
      <details className="box card" open={rows.length === 0}><summary>+ حساب جديد</summary>
        <form action={saveDivUser} className="form f3 mt">{fields()}<div className="full"><Submit>إنشاء الحساب وإرسال رابط التفعيل</Submit></div></form>
        <p className="muted" style={{ fontSize: ".85rem" }}>الحكم أو المراقب يُضاف أولًا من «لجنة الحكام ← الحكام والمراقبون» ثم يُنشأ حسابه هنا.</p>
      </details>
      <div className="card table-wrap">
        {rows.length === 0 ? <Empty>لا حسابات في هذه الدرجة بعد</Empty> : (
          <table className="t"><thead><tr><th>الاسم</th><th>المستخدم</th><th>نوع الحساب</th><th>الجهة / الصلاحيات</th><th>الحالة</th><th></th></tr></thead>
            <tbody>{rows.map(({ u: t, club, official }) => (
              <tr key={t.id} className={t.isActive ? "" : "muted"}>
                <td><strong>{t.fullName}</strong><div className="muted kbd" style={{ fontSize: ".75rem" }}>{t.email}</div></td>
                <td className="kbd">{t.username}</td>
                <td>{ROLE_LABEL[t.role]}</td>
                <td style={{ fontSize: ".82rem", maxWidth: 340 }}>{club ?? official ?? (t.role === "DIV_STAFF" ? (t.customPerms?.length ? t.customPerms.map((p) => permLabel.get(p) ?? p).join("، ") : "صلاحيات الدور الافتراضية") : "—")}</td>
                <td>{status(t)}</td>
                <td>{editable(t) && (
                  <details><summary className="btn btn-sm btn-light">إدارة</summary>
                    <div style={{ minWidth: 380 }}>
                      <form action={saveDivUser} className="form f1 mt">{fields(t)}<Submit>حفظ</Submit></form>
                      <div className="row mt">
                        <form action={divUserAction}><input type="hidden" name="d" value={d.id} /><input type="hidden" name="id" value={t.id} /><input type="hidden" name="op" value="toggle" />
                          <Submit className={`btn btn-sm ${t.isActive ? "btn-danger" : "btn-light"}`}>{t.isActive ? "تعطيل" : "تفعيل"}</Submit></form>
                        {!t.isVerified && <form action={divUserAction}><input type="hidden" name="d" value={d.id} /><input type="hidden" name="id" value={t.id} /><input type="hidden" name="op" value="activation" />
                          <Submit className="btn btn-sm btn-light">إعادة إرسال التفعيل</Submit></form>}
                        {t.isVerified && <form action={divUserAction}><input type="hidden" name="d" value={d.id} /><input type="hidden" name="id" value={t.id} /><input type="hidden" name="op" value="reset" />
                          <Submit className="btn btn-sm btn-light">رابط كلمة مرور جديدة</Submit></form>}
                      </div>
                    </div>
                  </details>)}</td>
              </tr>))}</tbody></table>
        )}
      </div>
    </>
  );
}

