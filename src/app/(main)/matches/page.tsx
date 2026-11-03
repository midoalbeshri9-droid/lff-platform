import Link from "next/link";
import { and, eq, desc, asc, gte, lte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { matches, clubs, competitions } from "@/db/schema";
import { scopeOf, clubIn, compIn, officialIn, regIn, guardPage, inScopeClub, inScopeComp, inScopeMatch, inScopePlayer, inScopeReg, inScopeOfficial, inScopeSanction, inScopeStaff } from "@/lib/scope";
import { requireUser } from "@/lib/auth";
import { MATCH_STATUS, REPORT_STATUS } from "@/lib/labels";
import { fmtDateTime, fromLocalInput } from "@/lib/util";
import { PageHead, Badge, Empty, Options, type SP } from "@/components/ui";

export default async function Matches({ searchParams }: { searchParams: SP }) {
  const u = await requireUser("comp.view", "ref.view");
  const sc = await scopeOf(u);
  const sp = await searchParams;
  const h = alias(clubs, "h"), a = alias(clubs, "a");
  const comps = await db.select({ id: competitions.id, name: competitions.name }).from(competitions).where(compIn(sc, competitions.id)).orderBy(desc(competitions.id));
  const from = fromLocalInput(sp.from ? sp.from + "T00:00" : null), to = fromLocalInput(sp.to ? sp.to + "T23:59" : null);
  const rows = await db.select({ m: matches, home: h.name, away: a.name, comp: competitions.name }).from(matches)
    .innerJoin(h, eq(h.id, matches.homeClubId)).innerJoin(a, eq(a.id, matches.awayClubId)).innerJoin(competitions, eq(competitions.id, matches.competitionId))
    .where(and(
      compIn(sc, matches.competitionId),
      sp.comp ? eq(matches.competitionId, Number(sp.comp)) : undefined,
      sp.status ? eq(matches.status, sp.status as "PLAYED") : undefined,
      sp.report ? eq(matches.reportStatus, sp.report as "SUBMITTED") : undefined,
      sp.round ? eq(matches.round, Number(sp.round)) : undefined,
      from ? gte(matches.kickoff, from) : undefined, to ? lte(matches.kickoff, to) : undefined,
    ))
    .orderBy(sp.report === "SUBMITTED" ? asc(matches.reportSubmittedAt) : asc(matches.kickoff)).limit(400);
  return (
    <>
      <PageHead title="المباريات" />
      <form className="filters">
        <div className="field"><label>المسابقة</label><select name="comp" defaultValue={sp.comp ?? ""}><option value="">الكل</option>{comps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field"><label>الجولة</label><input type="number" name="round" defaultValue={sp.round} style={{ width: 80 }} /></div>
        <div className="field"><label>الحالة</label><select name="status" defaultValue={sp.status ?? ""}><option value="">الكل</option><Options map={MATCH_STATUS} /></select></div>
        <div className="field"><label>التقرير</label><select name="report" defaultValue={sp.report ?? ""}><option value="">الكل</option><Options map={REPORT_STATUS} /></select></div>
        <div className="field"><label>من</label><input type="date" name="from" defaultValue={sp.from} /></div>
        <div className="field"><label>إلى</label><input type="date" name="to" defaultValue={sp.to} /></div>
        <button className="btn btn-light">عرض</button>
      </form>
      <div className="card table-wrap">
        {rows.length === 0 ? <Empty>لا مباريات</Empty> : (
          <table className="t"><thead><tr><th>المسابقة</th><th>ج</th><th>المباراة</th><th>الموعد</th><th>الملعب</th><th>النتيجة</th><th>الحالة</th><th>التقرير</th><th></th></tr></thead>
            <tbody>{rows.map(({ m, home, away, comp }) => (
              <tr key={m.id} className={m.reportStatus === "SUBMITTED" ? "hl" : ""}><td>{comp}</td><td className="num">{m.round}</td><td><strong>{home}</strong> × <strong>{away}</strong></td>
                <td>{fmtDateTime(m.kickoff)}</td><td>{m.venue}</td><td className="num">{m.homeScore != null ? `${m.homeScore} - ${m.awayScore}` : "—"}</td>
                <td><Badge v={MATCH_STATUS[m.status]} /></td><td><Badge v={REPORT_STATUS[m.reportStatus]} /></td>
                <td><Link className="btn btn-sm btn-light" href={`/matches/${m.id}`}>فتح</Link></td></tr>
            ))}</tbody></table>
        )}
      </div>
    </>
  );
}
