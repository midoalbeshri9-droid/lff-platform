import { notFound } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { matches, competitions, clubs, matchSquads, matchRequests } from "@/db/schema";
import { matchNotices } from "@/lib/sanctions";
import { SANCTION_TYPE } from "@/lib/labels";
import { Field } from "@/components/ui";
import { Submit } from "@/components/Client";
import { requireClubUser } from "@/lib/auth";
import { clubEligibility } from "@/lib/eligibility";
import { fmtDateTime, dayOf } from "@/lib/util";
import { PageHead, Flash, type SP } from "@/components/ui";
import { LineupForm } from "@/components/LineupForm";
import { saveClubLineup, requestPostpone } from "../../actions";

export default async function ClubLineup({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const u = await requireClubUser("club.view");
  const id = Number((await params).id);
  const sp = await searchParams;
  const [m] = await db.select().from(matches).where(eq(matches.id, id));
  if (!m || (m.homeClubId !== u.clubId && m.awayClubId !== u.clubId)) notFound();
  const [c] = await db.select().from(competitions).where(eq(competitions.id, m.competitionId));
  const [opp] = await db.select().from(clubs).where(eq(clubs.id, m.homeClubId === u.clubId ? m.awayClubId : m.homeClubId));
  const on = dayOf(m.kickoff ?? new Date());
  const elig = await clubEligibility(u.clubId, m.competitionId, on);
  const squad = await db.select().from(matchSquads).where(and(eq(matchSquads.matchId, id), eq(matchSquads.clubId, u.clubId)));
  const reqs = await db.select().from(matchRequests).where(and(eq(matchRequests.matchId, id), eq(matchRequests.clubId, u.clubId)));
  const notices = await matchNotices(id);
  const locked = m.status !== "SCHEDULED" && m.status !== "POSTPONED" || (m.kickoff != null && m.kickoff.getTime() < Date.now()) || !u.can("club.lineups");
  return (
    <>
      <PageHead title={`قائمة المباراة ضد ${opp.name}`} sub={`${c.name} — الجولة ${m.round} — ${fmtDateTime(m.kickoff)} — ${m.venue ?? ""}`} crumbs={[["المباريات", "/club/matches"], ["القائمة"]]} />
      <Flash sp={sp} />
      {locked && <div className="alert warn">القائمة للعرض فقط (بدأت المباراة أو انتهت).</div>}
      {notices.map((n) => <div key={n.id} className="alert err">⚖ {SANCTION_TYPE[n.type]} — قرار {n.number}: {n.reason}</div>)}
      {reqs.map((r) => <div key={r.id} className="alert info">طلب تأجيل ({r.status === "PENDING" ? "قيد النظر" : r.status === "APPROVED" ? "مقبول" : "مرفوض"}): {r.reason}{r.decision && ` — ${r.decision}`}</div>)}
      <div className="card">
        <LineupForm action={saveClubLineup} matchId={id} clubId={u.clubId} elig={elig} squad={squad} readOnly={locked}
          startersCount={c.startersCount} squadMax={c.squadMax} maxForeign={c.maxForeign} />
      </div>
      {u.can("club.appeals") && m.status === "SCHEDULED" && !reqs.some((r) => r.status === "PENDING") && (
        <details className="box card"><summary>طلب تأجيل المباراة</summary>
          <form action={requestPostpone} className="form mt">
            <input type="hidden" name="matchId" value={id} />
            <Field label="السبب *" full><textarea name="reason" required /></Field>
            <Field label="الموعد المقترح"><input type="datetime-local" name="proposedDate" /></Field>
            <Field label="مستند داعم"><input type="file" name="document" accept="application/pdf,image/*" /></Field>
            <div className="full"><Submit>إرسال الطلب</Submit></div>
          </form>
        </details>
      )}
    </>
  );
}
