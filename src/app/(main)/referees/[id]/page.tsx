import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { officials, officialTests, assignments, matches, clubs, evaluations, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { OFFICIAL_TYPE, OFFICIAL_TYPE_INPUT, OFFICIAL_GRADE, FITNESS, OFFICIAL_STATUS, ASSIGN_ROLE, ASSIGN_STATUS } from "@/lib/labels";
import { fmtDate, fmtDateTime, today } from "@/lib/util";
import { PageHead, Flash, Badge, Field, Options, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { saveOfficial, setOfficialStatus, addTest, createOfficialAccount } from "../actions";

export default async function Official({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const u = await requireUser("ref.view");
  const id = Number((await params).id);
  const sp = await searchParams;
  const [o] = await db.select().from(officials).where(eq(officials.id, id));
  if (!o) notFound();
  const h = alias(clubs, "h"), a = alias(clubs, "a");
  const [tests, asg, evs, acct] = await Promise.all([
    db.select().from(officialTests).where(eq(officialTests.officialId, id)).orderBy(desc(officialTests.date)),
    db.select({ x: assignments, m: matches, home: h.name, away: a.name }).from(assignments).innerJoin(matches, eq(matches.id, assignments.matchId))
      .innerJoin(h, eq(h.id, matches.homeClubId)).innerJoin(a, eq(a.id, matches.awayClubId)).where(eq(assignments.officialId, id)).orderBy(desc(matches.kickoff)).limit(100),
    u.can("ref.evals") ? db.select().from(evaluations).where(eq(evaluations.officialId, id)) : Promise.resolve([]),
    db.select().from(users).where(eq(users.officialId, id)),
  ]);
  const sub = evs.filter((e) => e.isSubmitted);
  const avg = sub.length ? sub.reduce((s, e) => s + e.score, 0) / sub.length : null;
  const can = u.can("ref.manage");
  return (
    <>
      <PageHead title={o.fullName} sub={<>{OFFICIAL_TYPE[o.type]} — {OFFICIAL_GRADE[o.grade]} — <Badge v={OFFICIAL_STATUS[o.status]} /> <Badge v={FITNESS[o.fitness]} /></>} crumbs={[["الحكام والمراقبون", "/referees"], [o.fullName]]} />
      <Flash sp={sp} />
      <div className="grid g4">
        <div className="kpi"><div className="v">{asg.filter((x) => x.x.status === "APPROVED").length}</div><div className="l">تعيينات معتمدة</div></div>
        <div className="kpi ink"><div className="v">{avg?.toFixed(2) ?? "—"}</div><div className="l">متوسط التقييم ({sub.length})</div></div>
        <div className="kpi gold"><div className="v">{fmtDate(o.lastTestAt)}</div><div className="l">آخر اختبار لياقة</div></div>
        <div className={`kpi ${o.licenseExpiry && o.licenseExpiry < today() ? "red" : ""}`}><div className="v" style={{ fontSize: "1.3rem" }}>{fmtDate(o.licenseExpiry)}</div><div className="l">انتهاء الرخصة</div></div>
      </div>
      <div className="grid g-side mt">
        <div>
          <div className="card table-wrap"><h3>التعيينات</h3>
            <table className="t"><tbody>{asg.map(({ x, m, home, away }) => (
              <tr key={x.id}><td>{fmtDateTime(m.kickoff)}</td><td>{home} × {away}</td><td>{ASSIGN_ROLE[x.role]}</td><td><Badge v={ASSIGN_STATUS[x.status]} /></td>
                <td>{u.can("ref.evals") && evs.find((e) => e.matchId === m.id) && <span className="b b-indigo">{evs.find((e) => e.matchId === m.id)!.score.toFixed(1)}</span>}</td>
                <td><Link href={`/matches/${m.id}?tab=officials`}>المباراة</Link></td></tr>
            ))}</tbody></table>
          </div>
          <div className="card table-wrap"><h3>الاختبارات والدورات</h3>
            <table className="t"><tbody>{tests.map((t) => <tr key={t.id}><td>{fmtDate(t.date)}</td><td>{t.kind}</td><td>{t.title}</td><td>{t.passed ? <span className="b b-green">ناجح</span> : <span className="b b-red">راسب</span>}</td><td>{t.score ?? ""}</td></tr>)}</tbody></table>
            {can && (
              <form action={addTest} className="form f3 mt">
                <input type="hidden" name="officialId" value={id} />
                <Field label="النوع"><select name="kind"><option>لياقة</option><option>نظري</option><option>دورة</option></select></Field>
                <Field label="العنوان"><input type="text" name="title" required /></Field>
                <Field label="التاريخ"><input type="date" name="date" defaultValue={today()} required /></Field>
                <Field label="النتيجة"><select name="passed"><option value="1">ناجح</option><option value="0">راسب</option></select></Field>
                <Field label="الدرجة"><input type="number" step="0.1" name="score" /></Field>
                <div style={{ alignSelf: "end" }}><Submit className="btn btn-light">تسجيل</Submit></div>
              </form>
            )}
          </div>
        </div>
        <div>
          {can && (
            <div className="card">
              <h3>حساب الدخول</h3>
              {acct[0] ? <p>اسم المستخدم: <span className="kbd">{acct[0].username}</span> {!acct[0].isVerified ? <span className="b b-amber">بانتظار التفعيل</span> : acct[0].isActive ? <span className="b b-green">نشط</span> : <span className="b b-gray">معطّل</span>}</p> : (
                <form action={createOfficialAccount} className="stack">
                  <input type="hidden" name="officialId" value={id} />
                  <p className="muted" style={{ fontSize: ".85rem" }}>الحساب يتيح له رؤية تعييناته وإدخال تقاريره فقط.</p>
                  <input type="text" name="username" dir="ltr" placeholder="اسم المستخدم" required />
                  <input type="email" name="email" dir="ltr" placeholder="البريد (يصله رابط التفعيل)" defaultValue={o.email ?? ""} required />
                  <input type="tel" name="phone" dir="ltr" placeholder="الهاتف 09xxxxxxxx" defaultValue={o.phone ?? ""} required />
                  <Submit>إنشاء الحساب</Submit>
                </form>
              )}
            </div>
          )}
          {can && (
            <details className="box card"><summary>الحالة / الإيقاف</summary>
              <form action={setOfficialStatus} className="form f1 mt">
                <input type="hidden" name="id" value={id} />
                <Field label="الحالة"><select name="status" defaultValue={o.status}><Options map={OFFICIAL_STATUS} /></select></Field>
                <Field label="موقوف حتى"><input type="date" name="suspendedUntil" defaultValue={o.suspendedUntil ?? ""} /></Field>
                <Field label="ملاحظات"><textarea name="notes" defaultValue={o.notes ?? ""} /></Field>
                <Submit>حفظ</Submit>
              </form>
            </details>
          )}
          {can && (
            <details className="box card"><summary>تعديل البيانات</summary>
              <form action={saveOfficial} className="form f1 mt">
                <input type="hidden" name="id" value={id} />
                <Field label="الاسم"><input type="text" name="fullName" defaultValue={o.fullName} required /></Field>
                <Field label="النوع"><select name="type" defaultValue={o.type === "REF_OBSERVER" ? "COMMISSIONER" : o.type}><Options map={OFFICIAL_TYPE_INPUT} /></select></Field>
                <Field label="الدرجة"><select name="grade" defaultValue={o.grade}><Options map={OFFICIAL_GRADE} /></select></Field>
                <Field label="المدينة"><input type="text" name="city" defaultValue={o.city ?? ""} /></Field>
                <Field label="الهاتف"><input type="text" name="phone" defaultValue={o.phone ?? ""} dir="ltr" /></Field>
                <Field label="البريد"><input type="email" name="email" defaultValue={o.email ?? ""} dir="ltr" /></Field>
                <Field label="الميلاد"><input type="date" name="dateOfBirth" defaultValue={o.dateOfBirth ?? ""} /></Field>
                <Field label="رقم الرخصة"><input type="text" name="licenseNo" defaultValue={o.licenseNo ?? ""} /></Field>
                <Field label="انتهاء الرخصة"><input type="date" name="licenseExpiry" defaultValue={o.licenseExpiry ?? ""} /></Field>
                <Submit>حفظ</Submit>
              </form>
            </details>
          )}
        </div>
      </div>
    </>
  );
}
