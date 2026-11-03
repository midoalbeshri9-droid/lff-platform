import Link from "next/link";
import { eq, desc } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { matchRequests, matches, clubs, competitions } from "@/db/schema";
import { scopeOf, clubIn, compIn, officialIn, regIn, guardPage, inScopeClub, inScopeComp, inScopeMatch, inScopePlayer, inScopeReg, inScopeOfficial, inScopeSanction, inScopeStaff } from "@/lib/scope";
import { requireUser } from "@/lib/auth";
import { fmtDateTime, toLocalInput } from "@/lib/util";
import { fileUrl } from "@/lib/storage";
import { PageHead, Flash, Empty, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { decideMatchRequest } from "../actions";

export default async function Requests({ searchParams }: { searchParams: SP }) {
  const u = await requireUser("comp.view", "comp.requests");
  const sp = await searchParams;
  const h = alias(clubs, "h"), a = alias(clubs, "a"), rc = alias(clubs, "rc");
  const rows = await db.select({ r: matchRequests, m: matches, home: h.name, away: a.name, by: rc.name, comp: competitions.name }).from(matchRequests)
    .innerJoin(matches, eq(matches.id, matchRequests.matchId)).innerJoin(h, eq(h.id, matches.homeClubId)).innerJoin(a, eq(a.id, matches.awayClubId))
    .innerJoin(rc, eq(rc.id, matchRequests.clubId)).innerJoin(competitions, eq(competitions.id, matches.competitionId))
    .where(compIn(await scopeOf(u), matches.competitionId))
    .orderBy(desc(matchRequests.id)).limit(200);
  return (
    <>
      <PageHead title="طلبات تأجيل المباريات" />
      <Flash sp={sp} />
      {rows.length === 0 && <div className="card"><Empty>لا توجد طلبات</Empty></div>}
      {rows.map(({ r, m, home, away, by, comp }) => (
        <div key={r.id} className="card">
          <div className="card-head"><h3><Link href={`/matches/${m.id}`}>{home} × {away}</Link></h3>
            <span className={`b ${r.status === "PENDING" ? "b-amber" : r.status === "APPROVED" ? "b-green" : "b-red"}`}>{r.status === "PENDING" ? "قيد النظر" : r.status === "APPROVED" ? "مقبول" : "مرفوض"}</span></div>
          <p className="mb0">{comp} — الجولة {m.round} — الموعد الحالي {fmtDateTime(m.kickoff)}</p>
          <p>مقدم من: <strong>{by}</strong> ({r.createdBy}) — {fmtDateTime(r.createdAt)}{r.proposedDate && <> — الموعد المقترح: <strong>{fmtDateTime(r.proposedDate)}</strong></>}</p>
          <div className="doc-text">{r.reason}</div>
          {r.documentKey && <a href={fileUrl(r.documentKey)!} target="_blank">📎 المستند</a>}
          {r.decision && <div className="alert info mt mb0">القرار: {r.decision} — {r.decidedBy}</div>}
          {r.status === "PENDING" && u.can("comp.requests") && (
            <form action={decideMatchRequest} className="row mt">
              <input type="hidden" name="id" value={r.id} />
              <label>موعد جديد<input type="datetime-local" name="newDate" defaultValue={toLocalInput(r.proposedDate)} /></label>
              <input type="text" name="decision_text" placeholder="القرار / الملاحظة" style={{ flex: 1, minWidth: 200 }} />
              <Submit name="decision" value="approve">قبول التأجيل</Submit>
              <Submit name="decision" value="reject" className="btn btn-danger">رفض</Submit>
            </form>
          )}
        </div>
      ))}
    </>
  );
}
