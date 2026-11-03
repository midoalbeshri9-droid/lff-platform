import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, gte, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { stadiums, stadiumInspections, clubs, matches } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { stadiumBlock } from "@/lib/stadiums";
import { STADIUM_STATUS, INSPECTION_RESULT } from "@/lib/labels";
import { fmtDate, fmtDateTime, today } from "@/lib/util";
import { PageHead, Flash, Field, Empty, Badge, Options, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { saveStadium, addInspection, suspendStadium, reinstateStadium } from "../actions";

export default async function StadiumPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const u = await requireUser("comp.view");
  const id = Number((await params).id);
  const sp = await searchParams;
  const [s] = await db.select().from(stadiums).where(eq(stadiums.id, id));
  if (!s) notFound();
  const manage = u.can("comp.stadiums") && !u.divisionId; // مدير الدرجة يضيف ملاعب ولا يعدّل المسجلة
  const ins = await db.select().from(stadiumInspections).where(eq(stadiumInspections.stadiumId, id)).orderBy(desc(stadiumInspections.date));
  const h = alias(clubs, "h"), a = alias(clubs, "a");
  const up = await db.select({ m: matches, home: h.name, away: a.name }).from(matches).innerJoin(h, eq(h.id, matches.homeClubId)).innerJoin(a, eq(a.id, matches.awayClubId))
    .where(and(eq(matches.stadiumId, id), gte(matches.kickoff, new Date()))).orderBy(matches.kickoff).limit(30);
  const usedBy = await db.select({ id: clubs.id, name: clubs.name, main: clubs.mainStadiumId }).from(clubs).where(or(eq(clubs.mainStadiumId, id), eq(clubs.backupStadiumId, id))).orderBy(clubs.name);
  const block = stadiumBlock(s, today());
  return (
    <>
      <PageHead title={s.name} sub={<>{s.city} — <Badge v={STADIUM_STATUS[s.status]} /></>} crumbs={[["سجل الملاعب", "/competitions/stadiums"], [s.name]]} />
      <Flash sp={sp} />
      {usedBy.length > 0 && <div className="card row"><strong>الأندية المعتمدة عليه:</strong>{usedBy.map((c) => <span key={c.id} className={`b ${c.main === id ? "b-green" : "b-gray"}`}>{c.name} — {c.main === id ? "أساسي" : "احتياطي"}</span>)}</div>}
      {block && <div className="alert err">⛔ {block}{s.decisionRef ? ` — القرار: ${s.decisionRef}` : ""}</div>}
      <div className="grid g2">
        <div>
          <form action={saveStadium} className="card form f2">
            <input type="hidden" name="id" value={s.id} />
            <Field label="الاسم"><input type="text" name="name" defaultValue={s.name} required disabled={!manage} /></Field>
            <Field label="المدينة"><input type="text" name="city" defaultValue={s.city ?? ""} disabled={!manage} /></Field>
            <Field label="السعة"><input type="number" name="capacity" defaultValue={s.capacity ?? ""} disabled={!manage} /></Field>
            <Field label="الأرضية"><select name="surface" defaultValue={s.surface} disabled={!manage}><option value="NATURAL">طبيعية</option><option value="ARTIFICIAL">صناعية</option></select></Field>
            <Field label="الاعتماد حتى"><input type="date" name="approvalUntil" defaultValue={s.approvalUntil ?? ""} disabled={!manage} /></Field>
            <label className="check"><input type="checkbox" name="hasLights" value="1" defaultChecked={s.hasLights} disabled={!manage} /> إنارة كاشفة</label>
            <Field label="ملاحظات" full><textarea name="notes" defaultValue={s.notes ?? ""} disabled={!manage} /></Field>
            {manage && <div className="full"><Submit>حفظ</Submit></div>}
          </form>
          {manage && (
            <div className="card">
              <h3>إيقاف / إعادة اعتماد</h3>
              {s.status === "SUSPENDED" || s.status === "CLOSED" ? (
                <form action={reinstateStadium}><input type="hidden" name="id" value={s.id} /><Submit className="btn btn-primary" confirm="إعادة اعتماد الملعب؟">✓ إعادة اعتماد الملعب</Submit></form>
              ) : (
                <form action={suspendStadium} className="form f2">
                  <input type="hidden" name="id" value={s.id} />
                  <Field label="السبب *" full><input type="text" name="reason" required /></Field>
                  <Field label="حتى تاريخ" hint="فارغ = حتى إشعار آخر"><input type="date" name="until" /></Field>
                  <Field label="رقم القرار"><input type="text" name="decisionRef" /></Field>
                  <div className="row full"><Submit className="btn btn-danger" confirm="إيقاف الملعب وإبلاغ الأندية؟">⛔ إيقاف الملعب</Submit>
                    <button name="close" value="1" className="btn btn-ghost">إغلاق نهائي</button></div>
                </form>
              )}
            </div>
          )}
        </div>
        <div>
          <div className="card table-wrap">
            <h3>المعاينات</h3>
            {ins.length === 0 ? <Empty>لا معاينات</Empty> : (
              <table className="t"><tbody>{ins.map((x) => (
                <tr key={x.id}><td>{fmtDate(x.date)}</td><td><span className={`b ${x.result === "PASS" ? "b-green" : x.result === "FAIL" ? "b-red" : "b-amber"}`}>{INSPECTION_RESULT[x.result]}</span></td>
                  <td>{x.inspector}</td><td>{x.notes}</td><td>{x.fileKey && <a href={`/api/files/${x.fileKey}`} target="_blank">📄 التقرير</a>}</td></tr>
              ))}</tbody></table>
            )}
            {manage && (
              <details className="mt"><summary>+ تسجيل معاينة</summary>
                <form action={addInspection} className="form f2 mt">
                  <input type="hidden" name="stadiumId" value={s.id} />
                  <Field label="التاريخ"><input type="date" name="date" defaultValue={today()} /></Field>
                  <Field label="النتيجة"><select name="result"><Options map={INSPECTION_RESULT} /></select></Field>
                  <Field label="المعاين / اللجنة"><input type="text" name="inspector" /></Field>
                  <Field label="تمديد الاعتماد حتى"><input type="date" name="approvalUntil" /></Field>
                  <Field label="تقرير المعاينة (PDF/صورة)"><input type="file" name="file" accept="application/pdf,image/*" /></Field>
                  <Field label="ملاحظات" full><textarea name="notes" /></Field>
                  <div className="full"><Submit>حفظ المعاينة</Submit></div>
                </form>
              </details>
            )}
          </div>
          <div className="card table-wrap">
            <h3>المباريات القادمة على الملعب</h3>
            {up.length === 0 ? <Empty>لا مباريات قادمة</Empty> : (
              <table className="t"><tbody>{up.map(({ m, home, away }) => (
                <tr key={m.id} className={block ? "danger" : ""}><td>{fmtDateTime(m.kickoff)}</td><td><Link href={`/matches/${m.id}`}>{home} × {away}</Link></td></tr>
              ))}</tbody></table>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
