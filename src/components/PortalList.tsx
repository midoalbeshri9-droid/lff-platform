import Link from "next/link";
import { and, eq, desc, asc } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { assignments, matches, clubs, competitions } from "@/db/schema";
import { ASSIGN_ROLE, REPORT_STATUS } from "@/lib/labels";
import { fmtDateTime } from "@/lib/util";
import { Badge, Empty } from "./ui";

export async function PortalList({ officialId, past }: { officialId: number; past: boolean }) {
  const h = alias(clubs, "h"), a = alias(clubs, "a");
  const rows = await db.select({ x: assignments, m: matches, home: h.name, away: a.name, comp: competitions.name })
    .from(assignments).innerJoin(matches, eq(matches.id, assignments.matchId)).innerJoin(h, eq(h.id, matches.homeClubId)).innerJoin(a, eq(a.id, matches.awayClubId))
    .innerJoin(competitions, eq(competitions.id, matches.competitionId))
    .where(and(eq(assignments.officialId, officialId), eq(assignments.status, "APPROVED")))
    .orderBy(past ? desc(matches.kickoff) : asc(matches.kickoff));
  const list = rows.filter((r) => (past ? r.m.reportStatus === "APPROVED" || r.m.status !== "SCHEDULED" : r.m.reportStatus !== "APPROVED" && r.m.status === "SCHEDULED"));
  if (!list.length) return <div className="card"><Empty>{past ? "لا توجد مباريات سابقة" : "لا توجد تعيينات قادمة"}</Empty></div>;
  return (
    <>
      {list.map(({ x, m, home, away, comp }) => (
        <Link key={x.id} href={`/portal/matches/${m.id}`} className="card" style={{ display: "block", color: "inherit", textDecoration: "none" }}>
          <div className="row"><span className="b b-indigo">{ASSIGN_ROLE[x.role]}</span><span className="muted">{comp} — الجولة {m.round}</span><span className="spacer" />
            {x.role === "REFEREE" && <Badge v={REPORT_STATUS[m.reportStatus]} />}</div>
          <div className="match-card mt"><div className="t">{home}</div><div className="s">{m.homeScore != null ? `${m.homeScore} - ${m.awayScore}` : "×"}</div><div className="t">{away}</div></div>
          <div className="muted" style={{ textAlign: "center" }}>{fmtDateTime(m.kickoff)} — {m.venue}</div>
        </Link>
      ))}
    </>
  );
}
