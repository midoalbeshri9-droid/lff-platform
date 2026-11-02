import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, asc } from "drizzle-orm";
import { db } from "@/db";
import { matches, clubs, competitions, matchSquads, matchEvents, players, assignments, officials, commissionerReports, evaluations } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { clubEligibility } from "@/lib/eligibility";
import { MATCH_STATUS, REPORT_STATUS, EVENT_TYPE, ASSIGN_ROLE, ASSIGN_STATUS, SANCTION_TYPE, SANCTION_STATUS } from "@/lib/labels";
import { sanctions } from "@/db/schema";
import { matchNotices } from "@/lib/sanctions";
import { fmtDateTime, toLocalInput } from "@/lib/util";
import { PageHead, Flash, Badge, Empty, Field, Options, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { LineupForm } from "@/components/LineupForm";
import { saveMatch, deleteMatch, committeeLineup, addEvent, deleteEvent, setResult, approveReport, returnReport } from "../../competitions/actions";

export default async function MatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const u = await requireUser("comp.view", "ref.view");
  const id = Number((await params).id);
  const sp = await searchParams;
  const tab = sp.tab ?? "report";
  const [m] = await db.select().from(matches).where(eq(matches.id, id));
  if (!m) notFound();
  const [c] = await db.select().from(competitions).where(eq(competitions.id, m.competitionId));
  const [home] = await db.select().from(clubs).where(eq(clubs.id, m.homeClubId));
  const [away] = await db.select().from(clubs).where(eq(clubs.id, m.awayClubId));
  const name = (cid: number) => (cid === home.id ? home.name : away.name);
  const tabs: [string, string][] = [["report", "التقرير والأحداث"], ["lineups", "قوائم الفريقين"], ["officials", "الطاقم والمراقبة"], ["info", "بيانات المباراة"]];

  return (
    <>
      <PageHead title={`${home.name} × ${away.name}`} sub={<>{c.name} — الجولة {m.round} — {fmtDateTime(m.kickoff)} — {m.venue ?? ""} <Badge v={MATCH_STATUS[m.status]} /> <Badge v={REPORT_STATUS[m.reportStatus]} /></>}
        crumbs={[["المسابقات", "/competitions"], [c.name, `/competitions/${c.id}`], ["مباراة"]]}
        actions={<>
          {u.can("comp.sanctions") && <Link className="btn btn-danger" href={`/competitions/sanctions/new?match=${id}`}>⚖ قرار عقوبة</Link>}
          <Link className="btn btn-light" href={`/print/match/${id}`} target="_blank">🖨 ورقة المباراة</Link>
        </>} />
      <Flash sp={sp} />
      {(await matchNotices(id)).map((n) => <div key={n.id} className="alert err">⚖ {SANCTION_TYPE[n.type]} — قرار {n.number}: {n.reason}</div>)}
      <div className="card vs">
        <div className="team">{home.name}</div>
        <div className="score">{m.homeScore ?? "–"} : {m.awayScore ?? "–"}</div>
        <div className="team">{away.name}</div>
      </div>
      <div className="tabs">{tabs.map(([k, l]) => <Link key={k} href={`?tab=${k}`} className={`tab ${tab === k ? "active" : ""}`}>{l}</Link>)}</div>
      {tab === "report" && <Report m={m} u={u} name={name} />}
      {tab === "lineups" && <Lineups m={m} c={c} canEdit={u.can("comp.lineups") && m.reportStatus !== "APPROVED"} clubsList={[home, away]} />}
      {tab === "officials" && <Officials id={id} canAssign={u.can("ref.assign")} canEvals={u.canAny("ref.evals", "comp.view")} canReport={u.can("comp.view")} canSanction={u.can("comp.sanctions")} />}
      {tab === "report" && <MatchSanctions id={id} />}
      {tab === "info" && <Info m={m} home={home} away={away} canEdit={u.can("comp.manage")} />}
    </>
  );
}

async function Report({ m, u, name }: { m: typeof matches.$inferSelect; u: Awaited<ReturnType<typeof requireUser>>; name: (id: number) => string }) {
  const evs = await db.select({ e: matchEvents, player: players.fullName }).from(matchEvents).leftJoin(players, eq(players.id, matchEvents.playerId))
    .where(eq(matchEvents.matchId, m.id)).orderBy(asc(matchEvents.minute), asc(matchEvents.id));
  const squad = await db.select({ s: matchSquads, name: players.fullName }).from(matchSquads).innerJoin(players, eq(players.id, matchSquads.playerId)).where(eq(matchSquads.matchId, m.id));
  const can = u.can("comp.reports") && m.reportStatus !== "APPROVED";
  return (
    <div className="grid g-side">
      <div>
        {m.reportStatus === "SUBMITTED" && <div className="alert info">أرسل الحكم التقرير بتاريخ {fmtDateTime(m.reportSubmittedAt)} — راجع الأحداث ثم اعتمد.</div>}
        {m.reportStatus === "RETURNED" && <div className="alert warn">أُعيد التقرير للحكم: {m.reportReturn}</div>}
        <div className="card table-wrap">
          <h3>أحداث المباراة</h3>
          {evs.length === 0 ? <Empty>لا أحداث مسجلة</Empty> : (
            <table className="t"><tbody>{evs.map(({ e, player }) => (
              <tr key={e.id}><td className="num">{e.minute ? `${e.minute}'` : ""}</td><td>{EVENT_TYPE[e.type]}</td><td><strong>{player ?? "—"}</strong></td><td>{name(e.clubId)}</td><td className="muted">{e.note}</td>
                <td>{can && <form action={deleteEvent}><input type="hidden" name="matchId" value={m.id} /><input type="hidden" name="eventId" value={e.id} /><Submit className="btn btn-sm btn-ghost">✕</Submit></form>}</td></tr>
            ))}</tbody></table>
          )}
          {can && (
            <form action={addEvent} className="form f3 mt">
              <input type="hidden" name="matchId" value={m.id} />
              <Field label="الحدث"><select name="type"><Options map={EVENT_TYPE} /></select></Field>
              <Field label="الدقيقة"><input type="number" name="minute" min={0} max={130} /></Field>
              <Field label="اللاعب">
                <select name="playerId"><option value="">—</option>
                  {[m.homeClubId, m.awayClubId].map((cid) => (
                    <optgroup key={cid} label={name(cid)}>{squad.filter((s) => s.s.clubId === cid).map((s) => <option key={s.s.playerId} value={s.s.playerId}>{s.s.shirtNumber ? `${s.s.shirtNumber} - ` : ""}{s.name}</option>)}</optgroup>
                  ))}
                </select>
              </Field>
              <Field label="الفريق"><select name="clubId"><option value={m.homeClubId}>{name(m.homeClubId)}</option><option value={m.awayClubId}>{name(m.awayClubId)}</option></select></Field>
              <Field label="ملاحظة"><input type="text" name="note" /></Field>
              <div style={{ alignSelf: "end" }}><Submit className="btn btn-light">+ إضافة</Submit></div>
            </form>
          )}
          {squad.length === 0 && can && <p className="muted mt">لم تُدخل قوائم الفريقين — أدخلها من تبويب «قوائم الفريقين» لاختيار اللاعبين في الأحداث.</p>}
        </div>
        {m.reportNotes && <div className="card"><h3>ملاحظات الحكم</h3><div className="doc-text">{m.reportNotes}</div></div>}
      </div>
      <div>
        {can && (
          <form action={setResult} className="card stack">
            <h3>النتيجة</h3>
            <input type="hidden" name="matchId" value={m.id} />
            <div className="row" style={{ justifyContent: "center" }}>
              <input className="score-in" type="number" name="homeScore" defaultValue={m.homeScore ?? ""} min={0} /> <strong>:</strong> <input className="score-in" type="number" name="awayScore" defaultValue={m.awayScore ?? ""} min={0} />
            </div>
            <small className="muted">فارغة = تُحسب من الأهداف المسجلة عند الاعتماد</small>
            <Field label="الحضور الجماهيري"><input type="number" name="attendance" defaultValue={m.attendance ?? ""} /></Field>
            <Submit className="btn btn-light">حفظ</Submit>
          </form>
        )}
        {can && (
          <div className="card" style={{ borderTop: "4px solid var(--lff-gold)" }}>
            <h3>اعتماد التقرير</h3>
            <p className="muted" style={{ fontSize: ".85rem" }}>عند الاعتماد: تُثبت النتيجة في الترتيب، وتُحتسب مباراة للموقوفين، وتُنشأ إيقافات الطرد وتراكم الإنذارات تلقائيًا.</p>
            <form action={approveReport}><input type="hidden" name="matchId" value={m.id} /><Submit className="btn btn-primary w100" confirm="اعتماد تقرير المباراة نهائيًا؟">✓ اعتماد التقرير</Submit></form>
            {m.reportStatus === "SUBMITTED" && (
              <form action={returnReport} className="stack mt"><input type="hidden" name="matchId" value={m.id} />
                <textarea name="reason" placeholder="سبب الإعادة للحكم" required /><Submit className="btn btn-gold w100">↩ إعادة للحكم</Submit></form>
            )}
          </div>
        )}
        {m.reportStatus === "APPROVED" && <div className="alert ok">اعتمده {m.approvedBy} — {fmtDateTime(m.approvedAt)}</div>}
      </div>
    </div>
  );
}

async function Lineups({ m, c, canEdit, clubsList }: { m: typeof matches.$inferSelect; c: typeof competitions.$inferSelect; canEdit: boolean; clubsList: { id: number; name: string }[] }) {
  const on = (m.kickoff ?? new Date()).toISOString().slice(0, 10);
  const data = await Promise.all(clubsList.map(async (cl) => ({
    cl, elig: await clubEligibility(cl.id, m.competitionId, on),
    squad: await db.select().from(matchSquads).where(and(eq(matchSquads.matchId, m.id), eq(matchSquads.clubId, cl.id))),
  })));
  return (
    <>
      {data.map(({ cl, elig, squad }) => (
        <details key={cl.id} className="box card" open>
          <summary>{cl.name} — {squad.length ? <span className="b b-green">{squad.length} لاعب في القائمة</span> : <span className="b b-amber">لم تُرسل القائمة</span>}</summary>
          <div className="mt">
            <LineupForm action={committeeLineup} matchId={m.id} clubId={cl.id} elig={elig} squad={squad} readOnly={!canEdit}
              startersCount={c.startersCount} squadMax={c.squadMax} maxForeign={c.maxForeign} />
          </div>
        </details>
      ))}
    </>
  );
}

async function MatchSanctions({ id }: { id: number }) {
  const rows = await db.select().from(sanctions).where(eq(sanctions.matchId, id));
  if (!rows.length) return null;
  return (
    <div className="card table-wrap"><h3>قرارات مرتبطة بالمباراة</h3>
      <table className="t"><tbody>{rows.map((s) => <tr key={s.id}><td className="kbd">{s.number}</td><td>{SANCTION_TYPE[s.type]}</td><td>{s.reason.slice(0, 80)}</td><td><Badge v={SANCTION_STATUS[s.status]} /></td><td><Link href={`/competitions/sanctions/${s.id}`}>فتح</Link></td></tr>)}</tbody></table>
    </div>
  );
}

async function Officials({ id, canAssign, canEvals, canReport, canSanction }: { id: number; canAssign: boolean; canEvals: boolean; canReport: boolean; canSanction: boolean }) {
  const rows = await db.select({ a: assignments, name: officials.fullName }).from(assignments).innerJoin(officials, eq(officials.id, assignments.officialId)).where(eq(assignments.matchId, id));
  const [cr] = await db.select().from(commissionerReports).where(eq(commissionerReports.matchId, id));
  const ev = canEvals ? await db.select({ e: evaluations, name: officials.fullName }).from(evaluations).innerJoin(officials, eq(officials.id, evaluations.officialId)).where(eq(evaluations.matchId, id)) : [];
  return (
    <div className="grid g2">
      <div className="card table-wrap">
        <div className="card-head"><h3>طاقم التحكيم والمراقبة</h3>{canAssign && <Link className="btn btn-sm btn-light" href={`/referees/assignments/${id}`}>تعيين الطاقم</Link>}</div>
        {rows.length === 0 ? <Empty>لم يُعيّن الطاقم بعد</Empty> : (
          <table className="t"><tbody>{rows.map(({ a, name }) => <tr key={a.id}><td>{ASSIGN_ROLE[a.role]}</td><td><strong>{name}</strong></td><td><Badge v={ASSIGN_STATUS[a.status]} /></td></tr>)}</tbody></table>
        )}
      </div>
      <div>
        {canReport && <div className="card">
          <div className="card-head"><h3>تقرير مراقب المباراة</h3>{cr?.isSubmitted && canSanction && <Link className="btn btn-sm btn-danger" href={`/competitions/sanctions/new?match=${id}`}>⚖ تحويل إلى عقوبة</Link>}</div>
          {!cr?.isSubmitted ? <p className="muted">لم يُرسل بعد</p> : (
            <dl className="dl">
              <dt>انطلاق فعلي</dt><dd>{cr.actualKickoff}</dd><dt>الحضور</dt><dd>{cr.attendance}</dd><dt>الملعب</dt><dd>{cr.pitch}</dd>
              <dt>التنظيم</dt><dd>{cr.organization}</dd><dt>الأمن والجماهير</dt><dd>{cr.security}</dd><dt>الحوادث</dt><dd>{cr.incidents}</dd><dt>التوصيات</dt><dd>{cr.recommendations}</dd>
            </dl>
          )}
        </div>}
        {canEvals && (
          <div className="card table-wrap">
            <h3>تقييم الحكام (من تقرير مراقب المباراة)</h3>
            {ev.length === 0 ? <p className="muted">لا تقييمات</p> : (
              <table className="t"><tbody>{ev.map(({ e, name }) => <tr key={e.id}><td>{ASSIGN_ROLE[e.role]}</td><td>{name}</td><td className="num"><strong>{e.score.toFixed(1)}</strong></td><td>{e.isSubmitted ? <span className="b b-green">مرسل</span> : <span className="b b-gray">مسودة</span>}</td></tr>)}</tbody></table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Info({ m, home, away, canEdit }: { m: typeof matches.$inferSelect; home: { id: number; name: string }; away: { id: number; name: string }; canEdit: boolean }) {
  return (
    <div className="card">
      <form action={saveMatch} className="form f3">
        <input type="hidden" name="id" value={m.id} /><input type="hidden" name="competitionId" value={m.competitionId} />
        <input type="hidden" name="homeClubId" value={home.id} /><input type="hidden" name="awayClubId" value={away.id} />
        <Field label="الجولة"><input type="number" name="round" defaultValue={m.round} disabled={!canEdit} /></Field>
        <Field label="الموعد"><input type="datetime-local" name="kickoff" defaultValue={toLocalInput(m.kickoff)} disabled={!canEdit} /></Field>
        <Field label="الحالة"><select name="status" defaultValue={m.status} disabled={!canEdit}><Options map={MATCH_STATUS} /></select></Field>
        <Field label="الملعب"><input type="text" name="venue" defaultValue={m.venue ?? ""} disabled={!canEdit} /></Field>
        <Field label="المدينة"><input type="text" name="city" defaultValue={m.city ?? ""} disabled={!canEdit} /></Field>
        <Field label="المجموعة"><input type="text" name="groupName" defaultValue={m.groupName ?? ""} disabled={!canEdit} /></Field>
        <Field label="ملاحظات" full><textarea name="notes" defaultValue={m.notes ?? ""} disabled={!canEdit} /></Field>
        {canEdit && <div className="full"><Submit>حفظ</Submit></div>}
      </form>
      {canEdit && m.reportStatus === "NONE" && (
        <form action={deleteMatch} className="mt"><input type="hidden" name="id" value={m.id} /><Submit className="btn btn-ghost" confirm="حذف المباراة؟">حذف المباراة</Submit></form>
      )}
    </div>
  );
}
