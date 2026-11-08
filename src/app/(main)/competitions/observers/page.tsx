import Link from "next/link";
import { WaButton } from "@/components/WaButton";
import { appUrl } from "@/lib/tokens";
import { and, eq, sql, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { officials, users, divisions, assignments, matches } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { scopeOf, officialIn } from "@/lib/scope";
import { OFFICIAL_STATUS } from "@/lib/labels";
import { fmtDate } from "@/lib/util";
import { PageHead, Flash, Field, Empty, Badge, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { saveObserver, setObserverStatus, observerAccount } from "./actions";

/** مراقبو المباريات المعتمدون — تديرهم لجنة المسابقات وتعيّنهم على المباريات */
export default async function Observers({ searchParams }: { searchParams: SP }) {
  const u = await requireUser("comp.observers");
  const sp = await searchParams;
  const sc = await scopeOf(u);
  const rows = await db.select({ o: officials, acc: users.username, verified: users.isVerified, accEmail: users.email, temp: users.mustChangePassword }).from(officials)
    .leftJoin(users, eq(users.officialId, officials.id))
    .where(and(eq(officials.type, "COMMISSIONER"), officialIn(sc, officials.id))).orderBy(officials.status, officials.fullName);
  const ids = rows.map((r) => r.o.id);
  const load = ids.length ? await db.select({ id: assignments.officialId, all: sql<number>`count(*)::int`, next: sql<number>`count(*) filter (where ${matches.kickoff} >= now())::int` })
    .from(assignments).innerJoin(matches, eq(matches.id, assignments.matchId))
    .where(and(inArray(assignments.officialId, ids), inArray(assignments.status, ["DRAFT", "APPROVED"]))).groupBy(assignments.officialId) : [];
  const dv = await db.select().from(divisions).orderBy(divisions.level);
  const canEdit = (o: typeof officials.$inferSelect) => !u.divisionId || o.divisionId === u.divisionId || (o.divisionId == null && ["COMP_HEAD", "COMP_STAFF"].includes(u.role));
  const fields = (o?: typeof officials.$inferSelect) => (
    <>
      {o && <input type="hidden" name="id" value={o.id} />}
      <Field label="الاسم *"><input type="text" name="fullName" defaultValue={o?.fullName} required /></Field>
      <Field label="المدينة"><input type="text" name="city" defaultValue={o?.city ?? ""} /></Field>
      <Field label="الهاتف"><input type="tel" name="phone" dir="ltr" defaultValue={o?.phone ?? ""} /></Field>
      <Field label="البريد"><input type="email" name="email" dir="ltr" defaultValue={o?.email ?? ""} /></Field>
      <Field label="رقم الاعتماد"><input type="text" name="licenseNo" defaultValue={o?.licenseNo ?? ""} /></Field>
      <Field label="الاعتماد حتى"><input type="date" name="licenseExpiry" defaultValue={o?.licenseExpiry ?? ""} /></Field>
      {!u.divisionId && <Field label="قائمة الدوري" hint="فارغ = القائمة الاتحادية (متاح لكل الدرجات)"><select name="divisionId" defaultValue={o?.divisionId ?? ""}><option value="">— الاتحادية —</option>{dv.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>}
      <Field label="ملاحظات"><input type="text" name="notes" defaultValue={o?.notes ?? ""} /></Field>
    </>
  );
  return (
    <>
      <PageHead title="مراقبو المباريات" sub="المراقبون المعتمدون لدى لجنة المسابقات — يُعيَّنون من تبويب «الطاقم والمراقبة» في صفحة المباراة، ويكتبون تقاريرهم في بوابتهم وفق نموذج اللجنة"
        actions={u.can("comp.manage") ? <Link className="btn btn-light" href="/competitions/report-templates">📝 نماذج التقارير</Link> : null} />
      <Flash sp={sp} />
      <details className="box card" open={rows.length === 0}><summary>+ مراقب جديد</summary>
        <form action={saveObserver} className="form f3 mt">{fields()}<div className="full"><Submit>حفظ</Submit></div></form>
      </details>
      <div className="card table-wrap">
        {rows.length === 0 ? <Empty>لا مراقبين معتمدين بعد</Empty> : (
          <table className="t"><thead><tr><th>المراقب</th><th>القائمة</th><th>المدينة</th><th>الاعتماد</th><th>الحالة</th><th>التعيينات (قادمة)</th><th>حساب البوابة</th><th></th></tr></thead>
            <tbody>{rows.map(({ o, acc, verified, accEmail, temp }) => {
              const l = load.find((x) => x.id === o.id);
              return (
                <tr key={o.id} className={o.status === "ACTIVE" ? "" : "muted"}>
                  <td><strong>{o.fullName}</strong><div className="muted kbd" style={{ fontSize: ".75rem" }}>{o.phone}</div></td>
                  <td style={{ fontSize: ".85rem" }}>{dv.find((d) => d.id === o.divisionId)?.name ?? "اتحادية"}</td>
                  <td>{o.city}</td>
                  <td style={{ fontSize: ".85rem" }}>{o.licenseNo}{o.licenseExpiry && <div className="muted">حتى {fmtDate(o.licenseExpiry)}</div>}</td>
                  <td><Badge v={OFFICIAL_STATUS[o.status]} />{o.suspendedUntil && <div className="muted" style={{ fontSize: ".75rem" }}>حتى {fmtDate(o.suspendedUntil)}</div>}</td>
                  <td className="num">{l?.all ?? 0} ({l?.next ?? 0})</td>
                  <td>{acc ? <><span className="kbd">{acc}</span> {!verified ? <span className="b b-amber">بانتظار التفعيل</span> : temp ? <span className="b b-amber">كلمة مرور مؤقتة</span> : <span className="b b-green">مفعّل</span>}{!accEmail && <span className="b" title="الحساب بدون بريد — تعيد اللجنة كلمة المرور عند نسيانها">بدون بريد</span>} <WaButton phone={o.phone} label="بيانات الدخول" text={`الاتحاد الليبي لكرة القدم — لجنة تنظيم المسابقات\nالسيد/ ${o.fullName}\nحسابكم في بوابة مراقبي المباريات:\nاسم المستخدم: ${acc}\nرابط الدخول: ${appUrl()}/login\nكلمة المرور المؤقتة تُسلَّم لكم من اللجنة، ويُطلب تغييرها عند أول دخول.`} /></> : <span className="muted">لا يوجد</span>}</td>
                  <td>{canEdit(o) && (
                    <details><summary className="btn btn-sm btn-light">إدارة</summary>
                      <div style={{ minWidth: 360 }}>
                        <form action={saveObserver} className="form f1 mt">{fields(o)}<Submit>حفظ البيانات</Submit></form>
                        <form action={setObserverStatus} className="row mt">
                          <input type="hidden" name="id" value={o.id} />
                          <select name="status" defaultValue={o.status}><option value="ACTIVE">نشط</option><option value="SUSPENDED">موقوف</option><option value="RETIRED">غير معتمد / معتزل</option></select>
                          <input type="date" name="until" title="الإيقاف حتى" defaultValue={o.suspendedUntil ?? ""} />
                          <Submit className="btn btn-sm btn-light">تغيير الحالة</Submit>
                        </form>
                        {!acc ? (
                          <form action={observerAccount} className="form f1 mt">
                            <input type="hidden" name="officialId" value={o.id} />
                            <strong style={{ fontSize: ".9rem" }}>إنشاء حساب البوابة</strong>
                            <Field label="اسم المستخدم *"><input type="text" name="username" dir="ltr" required /></Field>
                            <Field label="الهاتف *"><input type="tel" name="phone" dir="ltr" defaultValue={o.phone ?? ""} required /></Field>
                            <Field label="البريد (اختياري)" hint="إن وُجد يصله رابط التفعيل ولا حاجة لكلمة مرور"><input type="email" name="email" dir="ltr" defaultValue={o.email ?? ""} /></Field>
                            <Field label="كلمة مرور مؤقتة" hint="عند عدم وجود بريد — 8 أحرف على الأقل، حروف وأرقام، يغيّرها المراقب عند أول دخول"><input type="password" name="password" dir="ltr" autoComplete="new-password" /></Field>
                            <Field label="تأكيد كلمة المرور"><input type="password" name="confirm" dir="ltr" autoComplete="new-password" /></Field>
                            <Submit className="btn btn-sm btn-gold">إنشاء الحساب</Submit>
                          </form>
                        ) : (
                          accEmail ? <form action={observerAccount} className="mt"><input type="hidden" name="officialId" value={o.id} /><input type="hidden" name="op" value="reset" />
                            <Submit className="btn btn-sm btn-light">{verified ? "إرسال رابط كلمة مرور جديدة" : "إعادة إرسال التفعيل"}</Submit></form>
                          : <form action={observerAccount} className="form f1 mt"><input type="hidden" name="officialId" value={o.id} /><input type="hidden" name="op" value="reset" />
                            <strong style={{ fontSize: ".9rem" }}>تعيين كلمة مرور مؤقتة جديدة</strong>
                            <Field label="كلمة المرور المؤقتة" hint="8 أحرف على الأقل، حروف وأرقام"><input type="password" name="password" dir="ltr" autoComplete="new-password" required /></Field>
                            <Field label="تأكيد كلمة المرور"><input type="password" name="confirm" dir="ltr" autoComplete="new-password" required /></Field>
                            <Submit className="btn btn-sm btn-light">تعيين</Submit></form>
                        )}
                      </div>
                    </details>)}</td>
                </tr>);
            })}</tbody></table>
        )}
      </div>
      <p className="muted" style={{ fontSize: ".85rem" }}>مراقبو الحكام (تقييم أداء الطاقم) تبقى إدارتهم لدى لجنة الحكام.</p>
    </>
  );
}
