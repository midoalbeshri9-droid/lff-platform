import { and, eq, sql, desc } from "drizzle-orm";
import { db } from "@/db";
import { registrations, clubs, ageCategories, seasons, players, matches, matchEvents, competitions } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getCurrentSeason } from "@/lib/registration";
import { REG_TYPE } from "@/lib/labels";
import { PageHead, type SP } from "@/components/ui";

export default async function Reports({ searchParams }: { searchParams: SP }) {
  await requireUser("reports.view");
  const sp = await searchParams;
  const cur = await getCurrentSeason();
  const ss = await db.select().from(seasons).orderBy(desc(seasons.startDate));
  const sid = Number(sp.season ?? cur?.id ?? 0);
  const cats = await db.select().from(ageCategories).orderBy(ageCategories.sortOrder);
  const grid = await db.select({ club: clubs.name, cat: registrations.categoryId, n: sql<number>`count(*)::int`, foreign: sql<number>`sum(case when ${players.isForeign} then 1 else 0 end)::int` })
    .from(registrations).innerJoin(clubs, eq(clubs.id, registrations.clubId)).innerJoin(players, eq(players.id, registrations.playerId))
    .where(and(eq(registrations.seasonId, sid), eq(registrations.status, "APPROVED"))).groupBy(clubs.name, registrations.categoryId);
  const clubNames = [...new Set(grid.map((g) => g.club))].sort((a, b) => a.localeCompare(b, "ar"));
  const byType = await db.select({ type: registrations.type, status: registrations.status, n: sql<number>`count(*)::int` }).from(registrations)
    .where(eq(registrations.seasonId, sid)).groupBy(registrations.type, registrations.status);
  const cards = await db.select({ comp: competitions.name, type: matchEvents.type, n: sql<number>`count(*)::int` }).from(matchEvents)
    .innerJoin(matches, eq(matches.id, matchEvents.matchId)).innerJoin(competitions, eq(competitions.id, matches.competitionId))
    .where(and(eq(competitions.seasonId, sid), eq(matches.reportStatus, "APPROVED"))).groupBy(competitions.name, matchEvents.type);
  const comps = [...new Set(cards.map((c) => c.comp))];
  const cnt = (comp: string, types: string[]) => cards.filter((c) => c.comp === comp && types.includes(c.type)).reduce((s, c) => s + c.n, 0);
  return (
    <>
      <PageHead title="التقارير والإحصائيات" />
      <form className="filters"><div className="field"><label>الموسم</label><select name="season" defaultValue={String(sid)}>{ss.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div><button className="btn btn-light">عرض</button></form>
      <div className="card table-wrap">
        <h2>اللاعبون المعتمدون حسب النادي والفئة</h2>
        <table className="t"><thead><tr><th>النادي</th>{cats.map((c) => <th key={c.id} className="num">{c.name}</th>)}<th className="num">الأجانب</th><th className="num">المجموع</th></tr></thead>
          <tbody>{clubNames.map((cl) => {
            const rows = grid.filter((g) => g.club === cl);
            return <tr key={cl}><td><strong>{cl}</strong></td>{cats.map((c) => <td key={c.id} className="num">{rows.find((r) => r.cat === c.id)?.n ?? ""}</td>)}
              <td className="num">{rows.reduce((s, r) => s + r.foreign, 0) || ""}</td><td className="num"><strong>{rows.reduce((s, r) => s + r.n, 0)}</strong></td></tr>;
          })}
            <tr className="hl"><td><strong>المجموع</strong></td>{cats.map((c) => <td key={c.id} className="num"><strong>{grid.filter((g) => g.cat === c.id).reduce((s, g) => s + g.n, 0)}</strong></td>)}
              <td className="num"><strong>{grid.reduce((s, g) => s + g.foreign, 0)}</strong></td><td className="num"><strong>{grid.reduce((s, g) => s + g.n, 0)}</strong></td></tr>
          </tbody></table>
      </div>
      <div className="grid g2">
        <div className="card table-wrap">
          <h2>الطلبات حسب النوع</h2>
          <table className="t"><thead><tr><th>النوع</th><th className="num">معتمد</th><th className="num">قيد المراجعة</th><th className="num">مرفوض</th></tr></thead>
            <tbody>{Object.entries(REG_TYPE).map(([k, v]) => {
              const g = (s: string) => byType.find((x) => x.type === k && x.status === s)?.n ?? 0;
              return <tr key={k}><td>{v}</td><td className="num">{g("APPROVED") + g("TRANSFERRED") + g("EXPIRED")}</td><td className="num">{g("SUBMITTED")}</td><td className="num">{g("REJECTED")}</td></tr>;
            })}</tbody></table>
        </div>
        <div className="card table-wrap">
          <h2>الانضباط حسب المسابقة</h2>
          <table className="t"><thead><tr><th>المسابقة</th><th className="num">أهداف</th><th className="num">إنذارات</th><th className="num">طرد</th></tr></thead>
            <tbody>{comps.map((c) => <tr key={c}><td>{c}</td><td className="num">{cnt(c, ["GOAL", "PENALTY_GOAL", "OWN_GOAL"])}</td><td className="num">{cnt(c, ["YELLOW"])}</td><td className="num">{cnt(c, ["RED", "SECOND_YELLOW"])}</td></tr>)}</tbody></table>
        </div>
      </div>
    </>
  );
}
