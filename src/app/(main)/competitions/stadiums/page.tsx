import Link from "next/link";
import { eq, sql, gte, and } from "drizzle-orm";
import { db } from "@/db";
import { stadiums, clubs, matches } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { stadiumBlock } from "@/lib/stadiums";
import { STADIUM_STATUS } from "@/lib/labels";
import { fmtDate, today } from "@/lib/util";
import { PageHead, Flash, Field, Empty, Badge, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { saveStadium } from "./actions";

export default async function Stadiums({ searchParams }: { searchParams: SP }) {
  const u = await requireUser("comp.view");
  const sp = await searchParams;
  const rows = await db.select({ s: stadiums, club: clubs.name }).from(stadiums).leftJoin(clubs, eq(clubs.id, stadiums.clubId)).orderBy(stadiums.city, stadiums.name);
  const upcoming = await db.select({ id: matches.stadiumId, n: sql<number>`count(*)::int` }).from(matches)
    .where(and(eq(matches.status, "SCHEDULED"), gte(matches.kickoff, new Date()))).groupBy(matches.stadiumId);
  const cl = await db.select({ id: clubs.id, name: clubs.name }).from(clubs).orderBy(clubs.name);
  const t = today();
  const soon = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  return (
    <>
      <PageHead title="سجل الملاعب" sub="الملاعب المعتمدة وحالتها ومعايناتها — لا تُجدول مباراة على ملعب موقوف أو منتهي الاعتماد" />
      <Flash sp={sp} />
      <div className="card table-wrap">
        {rows.length === 0 ? <Empty>لا ملاعب مسجلة</Empty> : (
          <table className="t"><thead><tr><th>الملعب</th><th>المدينة</th><th>السعة</th><th>النادي</th><th>الأرضية</th><th>الحالة</th><th>الاعتماد حتى</th><th>آخر معاينة</th><th>مباريات قادمة</th><th></th></tr></thead>
            <tbody>{rows.map(({ s, club }) => {
              const block = stadiumBlock(s, t);
              return (
                <tr key={s.id} className={block ? "danger" : ""}>
                  <td><strong>{s.name}</strong>{s.hasLights && <span title="إنارة كاشفة"> 💡</span>}</td><td>{s.city}</td><td className="num">{s.capacity?.toLocaleString("en")}</td><td>{club}</td>
                  <td>{s.surface === "ARTIFICIAL" ? "صناعية" : "طبيعية"}</td><td><Badge v={STADIUM_STATUS[s.status]} /></td>
                  <td className={s.approvalUntil && s.approvalUntil <= soon ? "danger-text" : ""}>{fmtDate(s.approvalUntil)}</td><td>{fmtDate(s.lastInspection)}</td>
                  <td className="num">{upcoming.find((x) => x.id === s.id)?.n ?? 0}</td>
                  <td><Link className="btn btn-sm btn-light" href={`/competitions/stadiums/${s.id}`}>فتح</Link></td>
                </tr>
              );
            })}</tbody></table>
        )}
      </div>
      {u.can("comp.stadiums") && (
        <details className="card">
          <summary>+ إضافة ملعب</summary>
          <form action={saveStadium} className="form f3 mt">
            <Field label="اسم الملعب *"><input type="text" name="name" required /></Field>
            <Field label="المدينة"><input type="text" name="city" /></Field>
            <Field label="السعة"><input type="number" name="capacity" /></Field>
            <Field label="النادي المعتمد عليه"><select name="clubId"><option value="">—</option>{cl.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="الأرضية"><select name="surface"><option value="NATURAL">طبيعية</option><option value="ARTIFICIAL">صناعية</option></select></Field>
            <Field label="الاعتماد ساري حتى"><input type="date" name="approvalUntil" /></Field>
            <label className="check"><input type="checkbox" name="hasLights" value="1" /> إنارة كاشفة</label>
            <div className="full"><Submit>إضافة</Submit></div>
          </form>
        </details>
      )}
    </>
  );
}
