import Link from "next/link";
import { and, eq, or, desc, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { matches, clubs, competitions, matchSquads, competitionTeams } from "@/db/schema";
import { requireClubUser } from "@/lib/auth";
import { MATCH_STATUS } from "@/lib/labels";
import { fmtDateTime } from "@/lib/util";
import { PageHead, Badge, Empty } from "@/components/ui";

export default async function ClubMatches() {
  const u = await requireClubUser("club.view");
  const h = alias(clubs, "h"), a = alias(clubs, "a");
  const rows = await db
    .select({
      m: matches, home: h.name, away: a.name, comp: competitions.name,
      mine: sql<number>`(select count(*)::int from ${matchSquads} s where s.match_id = "matches"."id" and s.club_id = ${u.clubId})`,
    })
    .from(matches).innerJoin(h, eq(h.id, matches.homeClubId)).innerJoin(a, eq(a.id, matches.awayClubId))
    .innerJoin(competitions, eq(competitions.id, matches.competitionId))
    .where(or(eq(matches.homeClubId, u.clubId), eq(matches.awayClubId, u.clubId)))
    .orderBy(desc(matches.kickoff)).limit(200);
  const comps = await db.select({ id: competitions.id, name: competitions.name, squadListMax: competitions.squadListMax }).from(competitionTeams)
    .innerJoin(competitions, eq(competitions.id, competitionTeams.competitionId)).where(eq(competitionTeams.clubId, u.clubId));
  return (
    <>
      <PageHead title="مباريات النادي" sub="أرسل قائمة كل مباراة قبل موعدها — يفحص النظام أهلية كل لاعب من بيانات لجنة القيد" />
      <div className="card row">
        <strong>قوائم الموسم:</strong>
        {comps.length === 0 ? <span className="muted">النادي غير مشارك في مسابقات</span> : comps.map((c) => <Link key={c.id} className="btn btn-sm btn-light" href={`/club/competitions/${c.id}`}>{c.name}{c.squadListMax != null ? " (مطلوبة)" : ""}</Link>)}
      </div>
      <div className="card table-wrap">
        {rows.length === 0 ? <Empty>لا توجد مباريات</Empty> : (
          <table className="t"><thead><tr><th>المسابقة</th><th>الجولة</th><th>المباراة</th><th>الموعد</th><th>النتيجة</th><th>الحالة</th><th>قائمتنا</th><th></th></tr></thead>
            <tbody>{rows.map(({ m, home, away, comp, mine }) => (
              <tr key={m.id}>
                <td>{comp}</td><td className="num">{m.round}</td>
                <td><strong>{home}</strong> × <strong>{away}</strong></td><td>{fmtDateTime(m.kickoff)}</td>
                <td className="num">{m.homeScore != null ? `${m.homeScore} - ${m.awayScore}` : "—"}</td>
                <td><Badge v={MATCH_STATUS[m.status]} /></td>
                <td>{mine ? <span className="b b-green">{mine} لاعب</span> : <span className="b b-amber">لم تُرسل</span>}</td>
                <td><Link className="btn btn-sm btn-light" href={`/club/matches/${m.id}`}>القائمة</Link></td>
              </tr>))}
            </tbody></table>
        )}
      </div>
    </>
  );
}
