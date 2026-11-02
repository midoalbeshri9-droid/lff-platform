import Link from "next/link";
import { and, eq, sql, or, gte, asc } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { registrations, matches, clubs, competitions } from "@/db/schema";
import { requireClubUser } from "@/lib/auth";
import { getCurrentSeason, openWindow, foreignQuota } from "@/lib/registration";
import { clubBlockReason, clubBalance } from "@/lib/finance";
import { contracts, players } from "@/db/schema";
import { lte as lteD } from "drizzle-orm";
import { money } from "@/lib/util";
import { fmtDate, fmtDateTime } from "@/lib/util";
import { PageHead, Kpi, Empty } from "@/components/ui";

export default async function ClubHome() {
  const u = await requireClubUser("club.view");
  const season = await getCurrentSeason();
  const counts = season
    ? await db
        .select({ status: registrations.status, n: sql<number>`count(*)::int` })
        .from(registrations)
        .where(and(eq(registrations.clubId, u.clubId), eq(registrations.seasonId, season.id)))
        .groupBy(registrations.status)
    : [];
  const c = (s: string) => counts.find((x) => x.status === s)?.n ?? 0;
  const w = season ? await openWindow(season.id, u.clubId) : null;
  const quota = season ? (await foreignQuota(u.clubId, season.id)).filter((q) => q.max != null || q.used > 0) : [];
  const block = await clubBlockReason(u.clubId);
  const bal = u.can("club.finance") ? await clubBalance(u.clubId) : null;
  const soon = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
  const ending = await db.select({ c: contracts, name: players.fullName }).from(contracts).innerJoin(players, eq(players.id, contracts.playerId))
    .where(and(eq(contracts.clubId, u.clubId), eq(contracts.status, "ACTIVE"), lteD(contracts.endDate, soon))).orderBy(contracts.endDate).limit(10);
  const h = alias(clubs, "h"), a = alias(clubs, "a");
  const upcoming = await db
    .select({ m: matches, home: h.name, away: a.name, comp: competitions.name })
    .from(matches)
    .innerJoin(h, eq(h.id, matches.homeClubId))
    .innerJoin(a, eq(a.id, matches.awayClubId))
    .innerJoin(competitions, eq(competitions.id, matches.competitionId))
    .where(and(or(eq(matches.homeClubId, u.clubId), eq(matches.awayClubId, u.clubId)), eq(matches.status, "SCHEDULED"), gte(matches.kickoff, new Date())))
    .orderBy(asc(matches.kickoff))
    .limit(5);

  return (
    <>
      <PageHead title={`مرحبًا، ${u.clubName}`} sub={season ? `الموسم ${season.name}` : "لا يوجد موسم حالي"} actions={u.can("club.edit") && <Link className="btn btn-primary" href="/club/players/new">+ إضافة لاعب / طلب قيد</Link>} />
      {w ? (
        <div className="alert ok">فترة القيد مفتوحة: <strong>{w.label}</strong> حتى {fmtDate(w.endDate)}</div>
      ) : (
        <div className="alert warn">فترة القيد مغلقة حاليًا — يمكنك تجهيز الطلبات كمسودة وإرسالها عند فتح الفترة.</div>
      )}
      {block && <div className="alert err">⛔ {block}</div>}
      <div className="grid g4">
        <Kpi v={c("APPROVED")} l="لاعبون مقيدون (معتمد)" href="/club/players" />
        <Kpi v={c("SUBMITTED")} l="طلبات قيد المراجعة" color="ink" href="/club/requests?status=SUBMITTED" />
        <Kpi v={c("NEEDS_CORRECTION")} l="طلبات تحتاج استكمال" color="red" href="/club/requests?status=NEEDS_CORRECTION" />
        <Kpi v={c("DRAFT")} l="مسودات لم تُرسل" color="gold" href="/club/requests?status=DRAFT" />
      </div>
      <div className="grid g2 mt">
        {quota.length > 0 && (
          <div className="card">
            <h3>حصة اللاعبين الأجانب</h3>
            <table className="t"><tbody>{quota.map((q) => (
              <tr key={q.id}><td>{q.name}</td><td className="num">{q.used}{q.max != null ? ` / ${q.max}` : ""}</td>
                <td>{q.max == null ? <span className="muted">بلا حد</span> : q.used >= q.max ? <span className="b b-red">مكتمل</span> : <span className="b b-green">متبقٍ {q.max - q.used}</span>}</td></tr>
            ))}</tbody></table>
          </div>
        )}
        {bal && (
          <div className="card">
            <div className="card-head"><h3>الحساب المالي</h3><Link href="/club/finance">التفاصيل</Link></div>
            <dl className="dl"><dt>المستحق</dt><dd>{money(bal.total)}</dd><dt>المدفوع</dt><dd>{money(bal.paid)}</dd>
              <dt>المتبقي</dt><dd className={bal.outstanding > 0 ? "danger-text" : "ok-text"}>{money(bal.outstanding)}</dd></dl>
          </div>
        )}
        {ending.length > 0 && (
          <div className="card">
            <h3>عقود تنتهي قريبًا</h3>
            <table className="t"><tbody>{ending.map(({ c: k, name }) => (
              <tr key={k.id}><td>{name}</td><td>{k.endDate}</td><td><Link href={`/club/registrations/${k.registrationId}`}>عرض</Link></td></tr>
            ))}</tbody></table>
          </div>
        )}
      </div>
      <div className="card mt">
        <div className="card-head"><h2>المباريات القادمة</h2><Link href="/club/matches">كل المباريات</Link></div>
        {upcoming.length === 0 ? <Empty>لا توجد مباريات قادمة</Empty> : (
          <table className="t"><tbody>
            {upcoming.map(({ m, home, away, comp }) => (
              <tr key={m.id}>
                <td>{comp} — الجولة {m.round}</td>
                <td><strong>{home}</strong> × <strong>{away}</strong></td>
                <td>{fmtDateTime(m.kickoff)}</td>
                <td>{u.can("club.lineups") && <Link className="btn btn-sm btn-light" href={`/club/matches/${m.id}`}>قائمة المباراة</Link>}</td>
              </tr>
            ))}
          </tbody></table>
        )}
      </div>
    </>
  );
}
