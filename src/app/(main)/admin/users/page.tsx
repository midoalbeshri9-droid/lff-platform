import { and, eq, ilike, or, desc, lt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { users, clubs, officials, divisions } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/labels";
import { fmtDateTime } from "@/lib/util";
import { PageHead, Flash, Field, Options, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { saveUser, resetPassword, toggleUser, resendActivation, reset2fa, disableInactive } from "../actions";
import { required2faRoles } from "@/lib/totp";

export default async function Users({ searchParams }: { searchParams: SP }) {
  const me = await requireUser("admin.users");
  const sp = await searchParams;
  const inactive = sp.inactive ? Math.max(30, Number(sp.inactive) || 90) : 0;
  const before = new Date(Date.now() - inactive * 864e5);
  const req2fa = await required2faRoles();
  const [rows, cl, of] = await Promise.all([
    db.select({ u: users, club: clubs.name, off: officials.fullName }).from(users).leftJoin(clubs, eq(clubs.id, users.clubId)).leftJoin(officials, eq(officials.id, users.officialId))
      .where(and(inactive ? and(eq(users.isActive, true), or(lt(users.lastLoginAt, before), and(isNull(users.lastLoginAt), lt(users.createdAt, before)))) : undefined,
        sp.role ? eq(users.role, sp.role as "ADMIN") : undefined, sp.q ? or(ilike(users.fullName, `%${sp.q}%`), ilike(users.username, `%${sp.q}%`)) : undefined))
      .orderBy(users.role, desc(users.id)),
    db.select({ id: clubs.id, name: clubs.name }).from(clubs).orderBy(clubs.name),
    db.select({ id: officials.id, name: officials.fullName }).from(officials).orderBy(officials.fullName),
  ]);
  const dv = await db.select().from(divisions).orderBy(divisions.level);
  const form = (x?: (typeof rows)[number]["u"]) => (
    <form action={saveUser} className="form f3 mt">
      {x && <input type="hidden" name="id" value={x.id} />}
      <Field label="الاسم الكامل"><input type="text" name="fullName" defaultValue={x?.fullName} required /></Field>
      {!x && <Field label="اسم المستخدم"><input type="text" name="username" dir="ltr" required /></Field>}
      <Field label="الدور"><select name="role" defaultValue={x?.role ?? "REG_STAFF"}><Options map={ROLE_LABEL} /></select></Field>
      <Field label="النادي (لحسابات الأندية)"><select name="clubId" defaultValue={x?.clubId ?? ""}><option value="">—</option>{cl.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="الدرجة" hint="إلزامية لمدير/موظف الدرجة — ولأي دور اتحادي تحصر صلاحياته في هذه الدرجة"><select name="divisionId" defaultValue={x?.divisionId ?? ""}><option value="">— كل الدرجات (اتحادي) —</option>{dv.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
      <Field label="سجل الحكم/المراقب"><select name="officialId" defaultValue={x?.officialId ?? ""}><option value="">—</option>{of.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
      <Field label="رقم الهاتف *"><input type="tel" name="phone" dir="ltr" defaultValue={x?.phone ?? ""} required placeholder="0912345678" /></Field>
      <Field label="البريد الإلكتروني *" hint="يصله رابط التفعيل"><input type="email" name="email" dir="ltr" defaultValue={x?.email ?? ""} required placeholder="name@gmail.com" /></Field>
      <div style={{ alignSelf: "end" }}><Submit>{x ? "حفظ" : "إنشاء الحساب"}</Submit></div>
    </form>
  );
  return (
    <>
      <PageHead title="المستخدمون والحسابات" sub={`${rows.length} حساب — لجان الاتحاد، الأندية، الحكام والمراقبون`} />
      <div className="alert info">عند إنشاء حساب يصل للمستخدم رابط تفعيل على بريده، فيختار كلمة المرور بنفسه. الحساب لا يعمل قبل التفعيل.</div>
      <Flash sp={sp} />
      <details className="box card"><summary>+ مستخدم جديد</summary>{form()}</details>
      <form className="filters">
        <div className="field"><label>الدور</label><select name="role" defaultValue={sp.role ?? ""}><option value="">الكل</option><Options map={ROLE_LABEL} /></select></div>
        <div className="field grow"><label>بحث</label><input type="search" name="q" defaultValue={sp.q} /></div>
        <div className="field"><label>الخاملة</label><select name="inactive" defaultValue={sp.inactive ?? ""}><option value="">الكل</option><option value="60">لم تدخل منذ 60 يومًا</option><option value="90">منذ 90 يومًا</option><option value="180">منذ 180 يومًا</option></select></div>
        <button className="btn btn-light">بحث</button>
      </form>
      {inactive > 0 && rows.length > 0 && (
        <form action={disableInactive} className="alert warn row" style={{ gap: 8 }}>
          <input type="hidden" name="days" value={inactive} />
          <span>{rows.length} حساب نشط لم يُستخدم منذ {inactive} يومًا — الحسابات المهملة أسهل طريق للاختراق (موظف ترك العمل، كلمة مرور قديمة).</span>
          <Submit className="btn btn-sm btn-danger" confirm={`تعطيل ${rows.length} حسابًا؟ يمكن إعادة تفعيل أي حساب لاحقًا.`}>تعطيلها كلها</Submit>
        </form>
      )}
      <div className="card table-wrap">
        <table className="t"><thead><tr><th>الاسم</th><th>اسم المستخدم</th><th>الدور</th><th>مرتبط بـ</th><th>التواصل</th><th>آخر دخول</th><th>الحالة</th><th></th></tr></thead>
          <tbody>{rows.map(({ u, club, off }) => (
            <tr key={u.id} className={u.isActive ? "" : "danger"}>
              <td><strong>{u.fullName}</strong></td><td className="kbd">{u.username}</td><td>{ROLE_LABEL[u.role]}{u.divisionId && <div className="b b-blue" style={{ fontSize: ".72rem" }}>{dv.find((d) => d.id === u.divisionId)?.name}</div>}</td><td>{club ?? off ?? "—"}</td>
              <td className="kbd" style={{ fontSize: ".8rem" }}>{u.email ?? <span className="danger-text">بلا بريد</span>}<br />{u.phone ?? <span className="danger-text">بلا هاتف</span>}</td>
              <td>{fmtDateTime(u.lastLoginAt)}</td>
              <td>{!u.isVerified ? <span className="b b-amber">بانتظار التفعيل</span> : u.isActive ? <span className="b b-green">نشط</span> : <span className="b b-gray">معطّل</span>}{u.lockedUntil && u.lockedUntil > new Date() && <span className="b b-red">مقفل</span>}
                {u.totpEnabled ? <span className="b b-blue" title="التحقق بخطوتين مفعّل">🔐</span> : req2fa.includes(u.role) && u.isActive ? <span className="b b-amber" title="دوره ملزم بالتحقق بخطوتين ولم يفعّله">🔓 بلا 2FA</span> : null}</td>
              <td>
                <details><summary className="btn btn-sm btn-light">إدارة</summary>
                  <div style={{ minWidth: 320 }}>
                    {form(u)}
                    <div className="btn-row mt">
                      {!u.isVerified && <form action={resendActivation}><input type="hidden" name="id" value={u.id} /><Submit className="btn btn-sm btn-gold">إعادة إرسال التفعيل</Submit></form>}
                      {u.isVerified && <form action={resetPassword}><input type="hidden" name="id" value={u.id} /><Submit className="btn btn-sm btn-light">إرسال رابط كلمة مرور جديدة</Submit></form>}
                    </div>
                    {u.totpEnabled && <form action={reset2fa} className="mt"><input type="hidden" name="id" value={u.id} /><Submit className="btn btn-sm btn-ghost" confirm="إلغاء التحقق بخطوتين لهذا المستخدم (فقد هاتفه)؟">إلغاء التحقق بخطوتين (فقدان الهاتف)</Submit></form>}
                    {u.id !== me.id && <form action={toggleUser} className="mt"><input type="hidden" name="id" value={u.id} /><Submit className="btn btn-sm btn-ghost" confirm="تأكيد؟">{u.isActive ? "تعطيل الحساب" : "تفعيل الحساب"}</Submit></form>}
                  </div>
                </details>
              </td>
            </tr>
          ))}</tbody></table>
      </div>
    </>
  );
}
