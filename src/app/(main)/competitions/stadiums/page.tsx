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
import { saveStadium, setClubStadiums } from "./actions";

export default async function Stadiums({ searchParams }: { searchParams: SP }) {
  const u = await requireUser("comp.view");
  const sp = await searchParams;
  const rows = (await db.select().from(stadiums).orderBy(stadiums.city, stadiums.name)).map((s) => ({ s }));
  const upcoming = await db.select({ id: matches.stadiumId, n: sql<number>`count(*)::int` }).from(matches)
    .where(and(eq(matches.status, "SCHEDULED"), gte(matches.kickoff, new Date()))).groupBy(matches.stadiumId);
  const cl = await db.select({ id: clubs.id, name: clubs.name, city: clubs.city, main: clubs.mainStadiumId, backup: clubs.backupStadiumId }).from(clubs).where(eq(clubs.isActive, true)).orderBy(clubs.name);
  const usedBy = (id: number) => cl.filter((c) => c.main === id || c.backup === id).map((c) => `${c.name}${c.main === id ? "" : " (احتياطي)"}`);
  const t = today();
  const soon = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  return (
    <>
      <PageHead title="سجل الملاعب" sub="الملاعب المعتمدة وحالتها ومعايناتها — لا تُجدول مباراة على ملعب موقوف أو منتهي الاعتماد" />
      <Flash sp={sp} />
      <div className="card table-wrap">
        {rows.length === 0 ? <Empty>لا ملاعب مسجلة</Empty> : (
          <table className="t"><thead><tr><th>الملعب</th><th>المدينة</th><th>السعة</th><th>الأندية المعتمدة عليه</th><th>الأرضية</th><th>الحالة</th><th>الاعتماد حتى</th><th>آخر معاينة</th><th>مباريات قادمة</th><th></th></tr></thead>
            <tbody>{rows.map(({ s }) => {
              const block = stadiumBlock(s, t);
              return (
                <tr key={s.id} className={block ? "danger" : ""}>
                  <td><strong>{s.name}</strong>{s.hasLights && <span title="إنارة كاشفة"> 💡</span>}</td><td>{s.city}</td><td className="num">{s.capacity?.toLocaleString("en")}</td><td style={{ fontSize: ".85rem" }}>{usedBy(s.id).join("، ")}</td>
                  <td>{s.surface === "ARTIFICIAL" ? "صناعية" : "طبيعية"}</td><td><Badge v={STADIUM_STATUS[s.status]} /></td>
                  <td className={s.approvalUntil && s.approvalUntil <= soon ? "danger-text" : ""}>{fmtDate(s.approvalUntil)}</td><td>{fmtDate(s.lastInspection)}</td>
                  <td className="num">{upcoming.find((x) => x.id === s.id)?.n ?? 0}</td>
                  <td><Link className="btn btn-sm btn-light" href={`/competitions/stadiums/${s.id}`}>فتح</Link></td>
                </tr>
              );
            })}</tbody></table>
        )}
      </div>
      <div className="card table-wrap" id="clubs">
        <h3>ملاعب الأندية (م26)</h3>
        <p className="muted" style={{ fontSize: ".85rem" }}>يحدد كل نادٍ ملعبه الأساسي والاحتياطي من بوابته، أو تحدده اللجنة هنا. تُجدول مباريات النادي على ملعبه الأساسي، ويُقترح الاحتياطي عند إيقاف الأساسي.</p>
        <table className="t"><thead><tr><th>النادي</th><th>المدينة</th><th>الملعب الأساسي</th><th>الملعب الاحتياطي</th>{u.can("comp.stadiums") && <th></th>}</tr></thead>
          <tbody>{cl.map((c) => {
            const main = rows.find((r) => r.s.id === c.main)?.s, backup = rows.find((r) => r.s.id === c.backup)?.s;
            return u.can("comp.stadiums") ? (
              <tr key={c.id} className={!c.main ? "warn-row" : ""}>
                <td><strong>{c.name}</strong></td><td>{c.city}</td>
                <td colSpan={3}>
                  <form action={setClubStadiums} className="row">
                    <input type="hidden" name="clubId" value={c.id} />
                    <select name="mainStadiumId" defaultValue={c.main ?? ""} style={{ width: "auto" }}><option value="">— الأساسي —</option>{rows.filter((r) => r.s.status !== "CLOSED").map((r) => <option key={r.s.id} value={r.s.id}>{r.s.name}</option>)}</select>
                    <select name="backupStadiumId" defaultValue={c.backup ?? ""} style={{ width: "auto" }}><option value="">— الاحتياطي —</option>{rows.filter((r) => r.s.status !== "CLOSED").map((r) => <option key={r.s.id} value={r.s.id}>{r.s.name}</option>)}</select>
                    <Submit className="btn btn-sm btn-light">حفظ</Submit>
                  </form>
                </td>
              </tr>
            ) : (
              <tr key={c.id}><td><strong>{c.name}</strong></td><td>{c.city}</td><td>{main?.name ?? <span className="danger-text">غير محدد</span>}</td><td>{backup?.name ?? "—"}</td></tr>
            );
          })}</tbody></table>
      </div>
      {u.can("comp.stadiums") && (
        <details className="card">
          <summary>+ إضافة ملعب</summary>
          <form action={saveStadium} className="form f3 mt">
            <Field label="اسم الملعب *"><input type="text" name="name" required /></Field>
            <Field label="المدينة"><input type="text" name="city" /></Field>
            <Field label="السعة"><input type="number" name="capacity" /></Field>
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
