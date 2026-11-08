import Link from "next/link";
import { and, eq, ilike, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { officials, assignments, evaluations, users , divisions } from "@/db/schema";
import { scopeOf, compIn, officialIn, guard, guardPage, inScopeOfficial, inScopeMatch } from "@/lib/scope";
import { requireUser } from "@/lib/auth";
import { OFFICIAL_TYPE, REFEREE_TYPE_INPUT, OBSERVER_TYPES, OFFICIAL_GRADE, FITNESS, OFFICIAL_STATUS } from "@/lib/labels";
import { fmtDate, today } from "@/lib/util";
import { PageHead, Flash, Badge, Empty, Field, Options, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { saveOfficial } from "./actions";

export default async function Referees({ searchParams }: { searchParams: SP }) {
  const u = await requireUser("ref.view");
  const sp = await searchParams;
  const dv = await db.select().from(divisions).orderBy(divisions.level);
  const rows = await db.select({
    o: officials,
    games: sql<number>`(select count(*)::int from ${assignments} a where a.official_id = "officials"."id" and a.status = 'APPROVED')`,
    avg: sql<number | null>`(select round(avg(e.score)::numeric, 2)::float from ${evaluations} e where e.official_id = "officials"."id" and e.is_submitted)`,
    account: sql<string | null>`(select username from ${users} x where x.official_id = "officials"."id")`,
  }).from(officials)
    .where(and(officialIn(await scopeOf(u), officials.id), notInArray(officials.type, [...OBSERVER_TYPES]), sp.type ? eq(officials.type, sp.type as "REFEREE") : undefined, sp.status ? eq(officials.status, sp.status as "ACTIVE") : undefined, sp.q ? ilike(officials.fullName, `%${sp.q}%`) : undefined))
    .orderBy(officials.type, officials.grade, officials.fullName);
  const t = today();
  return (
    <>
      <PageHead title="الحكام" sub={`${rows.length} مسجل — مراقبو المباريات تديرهم لجنة المسابقات`} />
      <Flash sp={sp} />
      <form className="filters">
        <div className="field"><label>النوع</label><select name="type" defaultValue={sp.type ?? ""}><option value="">الكل</option><Options map={REFEREE_TYPE_INPUT} /></select></div>
        <div className="field"><label>الحالة</label><select name="status" defaultValue={sp.status ?? ""}><option value="">الكل</option><Options map={OFFICIAL_STATUS} /></select></div>
        <div className="field grow"><label>بحث</label><input type="search" name="q" defaultValue={sp.q} /></div>
        <button className="btn btn-light">عرض</button>
      </form>
      <div className="card table-wrap">
        {rows.length === 0 ? <Empty>لا يوجد</Empty> : (
          <table className="t"><thead><tr><th>الاسم</th><th>النوع</th><th>الدرجة</th><th>القائمة</th><th>المدينة</th><th>اللياقة</th><th>الرخصة</th><th>المباريات</th><th>متوسط التقييم</th><th>الحساب</th><th>الحالة</th><th></th></tr></thead>
            <tbody>{rows.map(({ o, games, avg, account }) => (
              <tr key={o.id}><td><strong>{o.fullName}</strong></td><td>{OFFICIAL_TYPE[o.type]}</td><td>{OFFICIAL_GRADE[o.grade]}</td><td style={{ fontSize: ".8rem" }}>{dv.find((d) => d.id === o.divisionId)?.name ?? <span className="muted">اتحادية</span>}</td><td>{o.city}</td>
                <td><Badge v={FITNESS[o.fitness]} /></td>
                <td className={o.licenseExpiry && o.licenseExpiry < t ? "danger-text" : ""}>{fmtDate(o.licenseExpiry)}</td>
                <td className="num">{games}</td><td className="num">{avg ?? "—"}</td><td>{account ? <span className="kbd">{account}</span> : <span className="muted">—</span>}</td>
                <td><Badge v={OFFICIAL_STATUS[o.status]} /></td><td><Link href={`/referees/${o.id}`}>الملف</Link></td></tr>
            ))}</tbody></table>
        )}
      </div>
      {u.can("ref.manage") && (
        <details className="box card"><summary>+ إضافة حكم</summary>
          <form action={saveOfficial} className="form f3 mt">
            <Field label="الاسم الكامل"><input type="text" name="fullName" required /></Field>
            <Field label="النوع"><select name="type"><Options map={REFEREE_TYPE_INPUT} /></select></Field>
            <Field label="الدرجة"><select name="grade" defaultValue="THIRD"><Options map={OFFICIAL_GRADE} /></select></Field>
            {!u.divisionId && <Field label="قائمة الدوري" hint="فارغ = القائمة الاتحادية"><select name="divisionId"><option value="">— الاتحادية —</option>{dv.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>}
            <Field label="المدينة"><input type="text" name="city" /></Field>
            <Field label="الهاتف"><input type="text" name="phone" dir="ltr" /></Field>
            <Field label="البريد"><input type="email" name="email" dir="ltr" /></Field>
            <Field label="تاريخ الميلاد"><input type="date" name="dateOfBirth" /></Field>
            <Field label="رقم الرخصة"><input type="text" name="licenseNo" /></Field>
            <Field label="انتهاء الرخصة"><input type="date" name="licenseExpiry" /></Field>
            <div className="full"><Submit>إضافة</Submit></div>
          </form>
        </details>
      )}
    </>
  );
}
