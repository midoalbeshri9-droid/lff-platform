import { notFound, redirect } from "next/navigation";
import { eq, asc } from "drizzle-orm";
import { db } from "@/db";
import { matches, clubs, competitions, matchSquads, players, registrations, matchEvents, assignments, officials } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { ASSIGN_ROLE, EVENT_TYPE } from "@/lib/labels";
import { fmtDateTime } from "@/lib/util";
import { PrintButton } from "@/components/Client";
import { Letterhead } from "@/components/Letterhead";

export default async function MatchSheet({ params }: { params: Promise<{ id: string }> }) {
  const u = await getCurrentUser();
  if (!u || !u.canAny("comp.view", "ref.view", "portal.referee", "portal.observer")) redirect("/denied");
  const id = Number((await params).id);
  const [m] = await db.select().from(matches).where(eq(matches.id, id));
  if (!m) notFound();
  if (u.isOfficial) {
    const mine = await db.select().from(assignments).where(eq(assignments.matchId, id));
    if (!mine.some((a) => a.officialId === u.officialId)) redirect("/denied");
  }
  const [c] = await db.select().from(competitions).where(eq(competitions.id, m.competitionId));
  const cl = await db.select().from(clubs).where(eq(clubs.id, m.homeClubId)).then(async (h) => [h[0], (await db.select().from(clubs).where(eq(clubs.id, m.awayClubId)))[0]]);
  const sq = await db.select({ s: matchSquads, name: players.fullName, num: registrations.number }).from(matchSquads)
    .innerJoin(players, eq(players.id, matchSquads.playerId)).innerJoin(registrations, eq(registrations.id, matchSquads.registrationId))
    .where(eq(matchSquads.matchId, id)).orderBy(asc(matchSquads.shirtNumber));
  const evs = await db.select({ e: matchEvents, name: players.fullName }).from(matchEvents).leftJoin(players, eq(players.id, matchEvents.playerId)).where(eq(matchEvents.matchId, id)).orderBy(asc(matchEvents.minute));
  const crew = await db.select({ a: assignments, name: officials.fullName }).from(assignments).innerJoin(officials, eq(officials.id, assignments.officialId)).where(eq(assignments.matchId, id));
  return (
    <div className="print-root">
      <div className="print-toolbar no-print"><PrintButton /></div>
      <div className="sheet">
        <Letterhead sub="لجنة المسابقات" subEn="Competitions Committee" />
        <h1 className="doc-title">ورقة المباراة — {c.name}</h1>
        <div className="meta-line"><span>الجولة {m.round}</span><span>{fmtDateTime(m.kickoff)}</span><span>{m.venue}</span></div>
        <div className="vs" style={{ margin: "10px 0 16px" }}><div className="team">{cl[0].name}</div><div className="score">{m.homeScore ?? "  "} : {m.awayScore ?? "  "}</div><div className="team">{cl[1].name}</div></div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {cl.map((club) => (
            <table key={club.id} className="roster-table">
              <thead><tr><th colSpan={4}>{club.name}</th></tr><tr><th>رقم</th><th>الاسم</th><th>رقم القيد</th><th>أساسي</th></tr></thead>
              <tbody>{sq.filter((x) => x.s.clubId === club.id).sort((a, b) => Number(b.s.isStarter) - Number(a.s.isStarter)).map((x) => (
                <tr key={x.s.id}><td>{x.s.shirtNumber}</td><td className="l">{x.name}{x.s.isCaptain && " (ك)"}</td><td>{x.num}</td><td>{x.s.isStarter ? "✓" : "احتياط"}</td></tr>
              ))}</tbody>
            </table>
          ))}
        </div>
        <h3 style={{ marginTop: 16 }}>الطاقم</h3>
        <table className="roster-table"><tbody>{crew.map((x) => <tr key={x.a.id}><td>{ASSIGN_ROLE[x.a.role]}</td><td className="l">{x.name}</td></tr>)}</tbody></table>
        <h3 style={{ marginTop: 16 }}>الأحداث</h3>
        <table className="roster-table"><tbody>{evs.length === 0 ? <tr><td style={{ height: 120 }}></td></tr> : evs.map((x) => (
          <tr key={x.e.id}><td>{x.e.minute}</td><td>{EVENT_TYPE[x.e.type]}</td><td className="l">{x.name}</td><td>{x.e.clubId === cl[0].id ? cl[0].name : cl[1].name}</td></tr>
        ))}</tbody></table>
        <div className="signatures"><div className="sig">حكم المباراة</div><div className="sig">مراقب المباراة</div></div>
      </div>
    </div>
  );
}
