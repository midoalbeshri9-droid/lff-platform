import Link from "next/link";
import { and, eq, gte, asc, desc, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { matches, clubs, competitions, assignments } from "@/db/schema";
import { scopeOf, compIn, officialIn, guard, guardPage, inScopeOfficial, inScopeMatch } from "@/lib/scope";
import { requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/util";
import { PageHead, Flash, Empty, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { approveAssignments } from "../actions";

export default async function Assignments({ searchParams }: { searchParams: SP }) {
  const u = await requireUser("ref.view");
  const sp = await searchParams;
  const h = alias(clubs, "h"), a = alias(clubs, "a");
  const sc = await scopeOf(u);
  const comps = await db.select({ id: competitions.id, name: competitions.name }).from(competitions).where(compIn(sc, competitions.id)).orderBy(desc(competitions.id));
  const rows = await db.select({
    m: matches, home: h.name, away: a.name, comp: competitions.name,
    total: sql<number>`(select count(*)::int from ${assignments} x where x.match_id = "matches"."id")`,
    drafts: sql<number>`(select count(*)::int from ${assignments} x where x.match_id = "matches"."id" and x.status = 'DRAFT')`,
    ref: sql<string | null>`(select o.full_name from ${assignments} x join officials o on o.id = x.official_id where x.match_id = "matches"."id" and x.role = 'REFEREE')`,
  }).from(matches).innerJoin(h, eq(h.id, matches.homeClubId)).innerJoin(a, eq(a.id, matches.awayClubId)).innerJoin(competitions, eq(competitions.id, matches.competitionId))
    .where(and(compIn(sc, matches.competitionId), sp.all ? undefined : gte(matches.kickoff, new Date(Date.now() - 864e5)), eq(matches.status, "SCHEDULED"), sp.comp ? eq(matches.competitionId, Number(sp.comp)) : undefined))
    .orderBy(asc(matches.kickoff)).limit(300);
  return (
    <>
      <PageHead title="تعيين الطواقم" sub="المباريات القادمة وحالة تعيين الحكام والمراقبين" />
      <Flash sp={sp} />
      <form className="filters">
        <div className="field"><label>المسابقة</label><select name="comp" defaultValue={sp.comp ?? ""}><option value="">الكل</option>{comps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <label className="check"><input type="checkbox" name="all" value="1" defaultChecked={!!sp.all} /> تشمل المباريات بلا موعد/السابقة</label>
        <button className="btn btn-light">عرض</button>
      </form>
      <div className="card table-wrap">
        {rows.length === 0 ? <Empty>لا مباريات قادمة</Empty> : (
          <table className="t"><thead><tr><th>الموعد</th><th>المسابقة</th><th>المباراة</th><th>حكم الساحة</th><th>الطاقم</th><th></th></tr></thead>
            <tbody>{rows.map(({ m, home, away, comp, total, drafts, ref }) => (
              <tr key={m.id} className={total === 0 ? "hl" : ""}><td>{fmtDateTime(m.kickoff)}</td><td>{comp} — ج{m.round}</td><td><strong>{home}</strong> × <strong>{away}</strong></td>
                <td>{ref ?? <span className="muted">—</span>}</td>
                <td>{total === 0 ? <span className="b b-amber">لم يُعيّن</span> : <span className="b b-blue">{total} / 6</span>} {drafts > 0 && <span className="b b-gray">{drafts} مسودة</span>}</td>
                <td className="btn-row">
                  <Link className="btn btn-sm btn-light" href={`/referees/assignments/${m.id}`}>{u.can("ref.assign") ? "تعيين" : "عرض"}</Link>
                  {u.can("ref.approve") && drafts > 0 && <form action={approveAssignments}><input type="hidden" name="matchId" value={m.id} /><input type="hidden" name="back" value="/referees/assignments" /><Submit className="btn btn-sm btn-primary">اعتماد</Submit></form>}
                </td></tr>
            ))}</tbody></table>
        )}
      </div>
    </>
  );
}
