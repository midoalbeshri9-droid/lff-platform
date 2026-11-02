import Link from "next/link";
import { and, eq, sql, gte, lte, isNull, asc } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { registrations, matches, assignments, suspensions, registrationWindows, clubs, competitions, contracts, players, charges, appeals, sanctions } from "@/db/schema";
import { money } from "@/lib/util";
import { requireUser } from "@/lib/auth";
import { getCurrentSeason } from "@/lib/registration";
import { ROLE_LABEL } from "@/lib/labels";
import { fmtDate, fmtDateTime, today } from "@/lib/util";
import { PageHead, Kpi, Empty } from "@/components/ui";

const n = sql<number>`count(*)::int`;
const one = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;

export default async function Dashboard() {
  const u = await requireUser();
  const season = await getCurrentSeason();
  const sid = season?.id ?? 0;
  const t = today();
  const week = new Date(Date.now() + 7 * 864e5);
  const windows = await db.select().from(registrationWindows).where(and(eq(registrationWindows.seasonId, sid), isNull(registrationWindows.clubId), eq(registrationWindows.isClosed, false), gte(registrationWindows.endDate, t))).orderBy(asc(registrationWindows.startDate)).limit(2);
  const h = alias(clubs, "h"), a = alias(clubs, "a");
  const [submitted, approved, correction, origin, reports, upcoming, unassigned, drafts, susp] = await Promise.all([
    one(db.select({ n }).from(registrations).where(eq(registrations.status, "SUBMITTED"))),
    one(db.select({ n }).from(registrations).where(and(eq(registrations.seasonId, sid), eq(registrations.status, "APPROVED")))),
    one(db.select({ n }).from(registrations).where(eq(registrations.status, "NEEDS_CORRECTION"))),
    one(db.select({ n }).from(registrations).where(and(eq(registrations.status, "SUBMITTED"), eq(registrations.originResponse, "OBJECTED")))),
    one(db.select({ n }).from(matches).where(eq(matches.reportStatus, "SUBMITTED"))),
    db.select({ m: matches, home: h.name, away: a.name, comp: competitions.name,
      crew: sql<number>`(select count(*)::int from ${assignments} x where x.match_id = "matches"."id" and x.status = 'APPROVED')` })
      .from(matches).innerJoin(h, eq(h.id, matches.homeClubId)).innerJoin(a, eq(a.id, matches.awayClubId)).innerJoin(competitions, eq(competitions.id, matches.competitionId))
      .where(and(gte(matches.kickoff, new Date()), lte(matches.kickoff, week), eq(matches.status, "SCHEDULED"))).orderBy(asc(matches.kickoff)).limit(10),
    one(db.select({ n }).from(matches).where(and(gte(matches.kickoff, new Date()), eq(matches.status, "SCHEDULED"), sql`not exists (select 1 from ${assignments} x where x.match_id = "matches"."id" and x.role = 'REFEREE')`))),
    one(db.select({ n }).from(assignments).where(eq(assignments.status, "DRAFT"))),
    one(db.select({ n }).from(suspensions).where(and(eq(suspensions.isLifted, false), sql`(${suspensions.kind} = 'MATCHES' and ${suspensions.matchesTotal} > ${suspensions.matchesServed}) or (${suspensions.kind} = 'ADMIN' and (${suspensions.endDate} is null or ${suspensions.endDate} >= ${t}))`))),
  ]);
  const soon = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
  const ending = u.can("reg.view") ? await db.select({ c: contracts, name: players.fullName, club: clubs.name }).from(contracts)
    .innerJoin(players, eq(players.id, contracts.playerId)).innerJoin(clubs, eq(clubs.id, contracts.clubId))
    .where(and(eq(contracts.status, "ACTIVE"), lte(contracts.endDate, soon))).orderBy(contracts.endDate).limit(10) : [];
  const fin = u.can("fin.view") ? (await db.select({
    recv: sql<string>`coalesce(sum(${charges.amount} - ${charges.paidAmount}) filter (where ${charges.direction} = 'IN' and ${charges.status} in ('OPEN','PARTIAL')), 0)`,
    pay: sql<string>`coalesce(sum(${charges.amount} - ${charges.paidAmount}) filter (where ${charges.direction} = 'OUT' and ${charges.status} in ('OPEN','PARTIAL')), 0)`,
  }).from(charges))[0] : null;
  const pendingAppeals = u.can("comp.view") ? await one(db.select({ n }).from(appeals).where(eq(appeals.status, "PENDING"))) : 0;
  const activeSanctions = u.can("comp.view") ? await one(db.select({ n }).from(sanctions).where(eq(sanctions.status, "ACTIVE"))) : 0;
  return (
    <>
      <PageHead title={`مرحبًا، ${u.fullName}`} sub={`${ROLE_LABEL[u.role]} — الموسم ${season?.name ?? "—"}`} />
      {u.can("reg.view") && (
        <>
          <h2>لجنة القيد وأوضاع اللاعبين</h2>
          {windows[0] ? (
            <div className={`alert ${windows[0].startDate <= t ? "ok" : "info"}`}>
              {windows[0].startDate <= t ? "فترة القيد مفتوحة" : "الفترة القادمة"}: <strong>{windows[0].label}</strong> ({fmtDate(windows[0].startDate)} ← {fmtDate(windows[0].endDate)})
            </div>
          ) : <div className="alert warn">لا توجد فترة قيد مفتوحة أو قادمة للموسم الحالي. {u.can("reg.windows") && <Link href="/registration/settings">فتح فترة</Link>}</div>}
          <div className="grid g4">
            <Kpi v={submitted} l="طلبات بانتظار المراجعة" color="gold" href="/registration/requests" />
            <Kpi v={approved} l="لاعبون مقيدون هذا الموسم" href="/registration/players" />
            <Kpi v={correction} l="طلبات مُعادة للأندية" color="ink" href="/registration/requests?status=NEEDS_CORRECTION" />
            <Kpi v={origin} l="طلبات عليها اعتراض نادٍ" color="red" href="/registration/requests" />
          </div>
        </>
      )}
      {u.canAny("comp.view", "ref.view") && (
        <>
          <h2 className="mt">المسابقات والتحكيم</h2>
          <div className="grid g4">
            {u.can("comp.view") && <Kpi v={reports} l="تقارير مباريات بانتظار الاعتماد" color="gold" href="/matches?report=SUBMITTED" />}
            {u.can("ref.view") && <Kpi v={unassigned} l="مباريات قادمة بلا حكم" color="red" href="/referees/assignments" />}
            {u.can("ref.view") && <Kpi v={drafts} l="تعيينات بانتظار الاعتماد" color="ink" href="/referees/assignments" />}
            <Kpi v={susp} l="إيقافات سارية" href="/registration/suspensions" />
          </div>
          {u.can("comp.view") && (
            <div className="grid g4 mt">
              <Kpi v={activeSanctions} l="عقوبات سارية" color="red" href="/competitions/sanctions?status=ACTIVE" />
              <Kpi v={pendingAppeals} l="طعون بانتظار البت" color="gold" href="/competitions/sanctions?status=APPEALED" />
            </div>
          )}
          <div className="card mt table-wrap">
            <h3>مباريات الأسبوع</h3>
            {upcoming.length === 0 ? <Empty>لا مباريات خلال 7 أيام</Empty> : (
              <table className="t"><tbody>{upcoming.map(({ m, home, away, comp, crew }) => (
                <tr key={m.id}><td>{fmtDateTime(m.kickoff)}</td><td>{comp}</td><td><strong>{home}</strong> × <strong>{away}</strong></td>
                  <td>{crew ? <span className="b b-green">الطاقم {crew}</span> : <span className="b b-amber">بلا طاقم</span>}</td>
                  <td><Link href={`/matches/${m.id}`}>فتح</Link></td></tr>
              ))}</tbody></table>
            )}
          </div>
        </>
      )}
      {fin && (
        <>
          <h2 className="mt">اللجنة المالية</h2>
          <div className="grid g4">
            <Kpi v={money(fin.recv)} l="مستحقات غير محصلة على الأندية" color="red" href="/finance/clubs" />
            <Kpi v={money(fin.pay)} l="مستحقات حكام غير مصروفة" color="ink" href="/finance/officials" />
          </div>
        </>
      )}
      {ending.length > 0 && (
        <div className="card mt table-wrap">
          <h3>عقود تنتهي خلال 60 يومًا</h3>
          <table className="t"><tbody>{ending.map(({ c, name, club }) => (
            <tr key={c.id}><td><strong>{name}</strong></td><td>{club}</td><td>{fmtDate(c.endDate)}</td><td><Link href={`/registration/requests/${c.registrationId}`}>عرض</Link></td></tr>
          ))}</tbody></table>
        </div>
      )}
    </>
  );
}
