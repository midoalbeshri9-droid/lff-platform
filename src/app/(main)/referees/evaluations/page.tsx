import Link from "next/link";
import { desc, eq, sql, and } from "drizzle-orm";
import { db } from "@/db";
import { officials, evaluations, seasons, matches, competitions } from "@/db/schema";
import { scopeOf, compIn, officialIn, guard, guardPage, inScopeOfficial, inScopeMatch } from "@/lib/scope";
import { requireUser } from "@/lib/auth";
import { getCurrentSeason } from "@/lib/registration";
import { OFFICIAL_TYPE, OFFICIAL_GRADE } from "@/lib/labels";
import { PageHead, Empty, type SP } from "@/components/ui";

export default async function Evaluations({ searchParams }: { searchParams: SP }) {
  const u = await requireUser("ref.evals");
  const sp = await searchParams;
  const cur = await getCurrentSeason();
  const ss = await db.select().from(seasons).orderBy(desc(seasons.startDate));
  const seasonId = Number(sp.season ?? cur?.id ?? 0);
  const rows = await db.select({
    o: officials, n: sql<number>`count(${evaluations.id})::int`, avg: sql<number>`round(avg(${evaluations.score})::numeric, 2)::float`,
    min: sql<number>`min(${evaluations.score})`, max: sql<number>`max(${evaluations.score})`,
  }).from(evaluations).innerJoin(officials, eq(officials.id, evaluations.officialId)).innerJoin(matches, eq(matches.id, evaluations.matchId))
    .innerJoin(competitions, eq(competitions.id, matches.competitionId))
    .where(and(compIn(await scopeOf(u), competitions.id), eq(evaluations.isSubmitted, true), eq(competitions.seasonId, seasonId)))
    .groupBy(officials.id).orderBy(sql`avg(${evaluations.score}) desc`);
  return (
    <>
      <PageHead title="ترتيب الحكام حسب التقييمات" sub="يُستخدم للترقية والهبوط بالدرجة وتوزيع المباريات" />
      <form className="filters"><div className="field"><label>الموسم</label><select name="season" defaultValue={String(seasonId)}>{ss.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div><button className="btn btn-light">عرض</button></form>
      <div className="card table-wrap">
        {rows.length === 0 ? <Empty>لا تقييمات مرسلة</Empty> : (
          <table className="t no-num"><thead><tr><th>#</th><th>الحكم</th><th>النوع</th><th>الدرجة</th><th className="num">عدد التقييمات</th><th className="num">المتوسط</th><th className="num">الأدنى</th><th className="num">الأعلى</th></tr></thead>
            <tbody>{rows.map(({ o, n, avg, min, max }, i) => (
              <tr key={o.id}><td>{i + 1}</td><td><Link href={`/referees/${o.id}`}><strong>{o.fullName}</strong></Link></td><td>{OFFICIAL_TYPE[o.type]}</td><td>{OFFICIAL_GRADE[o.grade]}</td>
                <td className="num">{n}</td><td className="num"><strong>{avg}</strong></td><td className="num">{min}</td><td className="num">{max}</td></tr>
            ))}</tbody></table>
        )}
      </div>
    </>
  );
}
