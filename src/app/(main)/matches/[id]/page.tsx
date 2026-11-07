import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, asc, inArray } from "drizzle-orm";
import { db } from "@/db";
import { matches, clubs, competitions, matchSquads, matchEvents, players, assignments, officials, commissionerReports, evaluations, staff } from "@/db/schema";
import { scopeOf, clubIn, compIn, officialIn, regIn, guardPage, inScopeClub, inScopeComp, inScopeMatch, inScopePlayer, inScopeReg, inScopeOfficial, inScopeSanction, inScopeStaff } from "@/lib/scope";
import { requireUser, getCurrentUser } from "@/lib/auth";
import { clubEligibility } from "@/lib/eligibility";
import { MATCH_STATUS, REPORT_STATUS, EVENT_TYPE, ASSIGN_ROLE, ASSIGN_STATUS, SANCTION_TYPE, SANCTION_STATUS, OBSERVER_ROLES, STAFF_ROLE, CARD_REASONS } from "@/lib/labels";
import { sanctions } from "@/db/schema";
import { matchNotices } from "@/lib/sanctions";
import { fmtDateTime, toLocalInput, dayOf } from "@/lib/util";
import { PageHead, Flash, Badge, Empty, Field, Options, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { LineupForm } from "@/components/LineupForm";
import { saveMatch, deleteMatch, committeeLineup, addEvent, deleteEvent, setResult, approveReport, returnReport, setPenalties } from "../../competitions/actions";
import { competitionStages } from "@/db/schema";
import { koRoundName } from "@/lib/competitionPure";
import { assignOfficial } from "../../referees/actions";
import { allStadiums } from "@/lib/stadiums";
import { canSeeReports } from "@/lib/reports";
import { MatchReportView, ConfidentialNote } from "@/components/MatchReportView";

export default async function MatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const u = await requireUser("comp.view", "ref.view");
  const id = Number((await params).id);
  const sp = await searchParams;
  const tab = sp.tab ?? "report";
  const [m] = await db.select().from(matches).where(eq(matches.id, id));
  if (!m) notFound();
  guardPage(await inScopeMatch(u, id));
  const [c] = await db.select().from(competitions).where(eq(competitions.id, m.competitionId));
  const [home] = await db.select().from(clubs).where(eq(clubs.id, m.homeClubId));
  const [away] = await db.select().from(clubs).where(eq(clubs.id, m.awayClubId));
  const name = (cid: number) => (cid === home.id ? home.name : away.name);
  const [stage] = m.stageId ? await db.select().from(competitionStages).where(eq(competitionStages.id, m.stageId)) : [];
  const ko = stage?.format === "KNOCKOUT";
  let roundLabel = `الجولة ${m.round}`;
  if (ko) {
    const inRound = await db.select({ t: matches.tieNo }).from(matches).where(and(eq(matches.stageId, stage.id), eq(matches.round, m.round), eq(matches.isThirdPlace, false)));
    roundLabel = m.isThirdPlace ? "مباراة المركز الثالث" : koRoundName(new Set(inRound.map((x) => x.t)).size * 2, m.round) + (m.leg === 2 ? " — الإياب" : "");
  }
  const tabs: [string, string][] = [["report", "التقرير والأحداث"], ["lineups", "قوائم الفريقين"], ["officials", "الطاقم والمراقبة"], ["info", "بيانات المباراة"]];

  return (
    <>
      <PageHead title={`${home.name} × ${away.name}`} sub={<>{c.name}{stage ? ` — ${stage.name}` : ""}{m.groupName ? ` — المجموعة ${m.groupName}` : ""} — {roundLabel} — {fmtDateTime(m.kickoff)} — {m.venue ?? ""} <Badge v={MATCH_STATUS[m.status]} /> <Badge v={REPORT_STATUS[m.reportStatus]} /></>}
        crumbs={[["المسابقات", "/competitions"], [c.name, `/competitions/${c.id}`], ["مباراة"]]}
        actions={<>
          {u.can("comp.sanctions") && <Link className="btn btn-danger" href={`/competitions/sanctions/new?match=${id}`}>⚖ قرار عقوبة</Link>}
          <Link className="btn btn-light" href={`/print/match/${id}`} target="_blank">🖨 ورقة المباراة</Link>
          {u.can("archive.view") && <Link className="btn btn-light" href={`/archive?match=${id}`}>🗄 وثائق المباراة</Link>}
        </>} />
      <Flash sp={sp} />
      {(await matchNotices(id)).map((n) => <div key={n.id} className="alert err">⚖ {SANCTION_TYPE[n.type]} — قرار {n.number}: {n.reason}</div>)}
      <div className="card vs">
        <div className="team">{home.name}</div>
        <div className="score">{m.homeScore ?? "–"} : {m.awayScore ?? "–"}{m.homePens != null && <div style={{ fontSize: ".9rem" }}>ترجيح {m.homePens} : {m.awayPens}</div>}</div>
        <div className="team">{away.name}</div>
      </div>
      <div className="tabs">{tabs.map(([k, l]) => <Link key={k} href={`?tab=${k}`} className={`tab ${tab === k ? "active" : ""}`}>{l}</Link>)}</div>
      {tab === "report" && <Report m={m} u={u} name={name} />}
      {tab === "report" && ko && u.can("comp.reports") && (
        <form action={setPenalties} className="card row">
          <input type="hidden" name="matchId" value={m.id} />
          <strong>ركلات الترجيح</strong>
          <span className="muted" style={{ fontSize: ".85rem" }}>عند التعادل في المباراة (أو في المجموع بعد الإياب) — نظام المرحلة: {stage.tieDecider === "PENS" ? "ركلات ترجيح مباشرة دون وقت إضافي" : "وقت إضافي (النتيجة بعده) ثم ركلات ترجيح"}</span>
          <Field label={home.name}><input className="score-in" type="number" name="homePens" min={0} defaultValue={m.homePens ?? ""} /></Field>
          <Field label={away.name}><input className="score-in" type="number" name="awayPens" min={0} defaultValue={m.awayPens ?? ""} /></Field>
          <Submit className="btn btn-light">حفظ</Submit>
        </form>
      )}
      {tab === "lineups" && <Lineups m={m} c={c} canEdit={u.can("comp.lineups") && m.reportStatus !== "APPROVED"} clubsList={[home, away]} />}
      {tab === "officials" && <Officials id={id} canObserver={u.can("comp.observers") && m.reportStatus !== "APPROVED"} canAssign={u.can("ref.assign")} canEvals={u.canAny("ref.evals", "comp.view")} canReport={canSeeReports(u)} canSanction={u.can("comp.sanctions")} />}
      {tab === "report" && <MatchSanctions id={id} />}
      {tab === "info" && <Info m={m} home={home} away={away} canEdit={u.can("comp.manage")} />}
      {tab === "info" && <datalist id="stadiums-list">{(await allStadiums()).filter((x) => x.status !== "CLOSED").map((x) => <option key={x.id} value={x.name}>{x.city ?? ""}</option>)}</datalist>}
    </>
  );
}

async function Report({ m, u, name }: { m: typeof matches.$inferSelect; u: Awaited<ReturnType<typeof requireUser>>; name: (id: number) => string }) {
  const evs = await db.select({ e: matchEvents, player: players.fullName, staffName: staff.fullName, staffRole: staff.role }).from(matchEvents).leftJoin(players, eq(players.id, matchEvents.playerId))
    .leftJoin(staff, eq(staff.id, matchEvents.staffId))
    .where(eq(matchEvents.matchId, m.id)).orderBy(asc(matchEvents.minute), asc(matchEvents.id));
  const [comp] = await db.select({ season: competitions.seasonId }).from(competitions).where(eq(competitions.id, m.competitionId));
  const clubStaff = await db.select({ id: staff.id, name: staff.fullName, role: staff.role, clubId: staff.clubId }).from(staff)
    .where(and(inArray(staff.clubId, [m.homeClubId, m.awayClubId]), eq(staff.seasonId, comp.season), eq(staff.status, "APPROVED"))).orderBy(staff.fullName);
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
            <table className="t"><tbody>{evs.map(({ e, player, staffName, staffRole }) => (
              <tr key={e.id}><td className="num">{e.minute ? `${e.minute}'` : ""}</td><td>{EVENT_TYPE[e.type]}</td><td><strong>{player ?? staffName ?? e.staffName ?? "—"}</strong>{(staffName || e.staffName) && <span className="muted" style={{ fontSize: ".78rem" }}> — مرافق{e.staffRole ? `: ${e.staffRole}` : staffRole ? `: ${STAFF_ROLE[staffRole]}` : ""}</span>}</td><td>{name(e.clubId)}</td><td className="muted">{e.note}</td>
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
              <Field label="سبب البطاقة / ملاحظة"><input type="text" name="note" list="card-reasons" /></Field>
              <datalist id="card-reasons">{CARD_REASONS.map((x) => <option key={x} value={x} />)}</datalist>
              <fieldset className="full box" style={{ padding: ".3rem .6rem" }}><legend style={{ fontSize: ".82rem" }}>بطاقة لمرافق (جهاز فني أو إداري) بدل اللاعب</legend>
                <div className="form f3">
                  <Field label="من الجهاز المسجّل"><select name="staffId"><option value="">—</option>
                    {[m.homeClubId, m.awayClubId].map((cid) => <optgroup key={cid} label={name(cid)}>{clubStaff.filter((x) => x.clubId === cid).map((x) => <option key={x.id} value={x.id}>{x.name} — {STAFF_ROLE[x.role]}</option>)}</optgroup>)}
                  </select></Field>
                  <Field label="أو الاسم يدويًا" hint="مع اختيار «الفريق»"><input type="text" name="staffName" /></Field>
                  <Field label="الصفة"><input type="text" name="staffRole" list="staff-roles" placeholder="مدير فني، إداري..." /></Field>
                  <datalist id="staff-roles">{[...Object.values(STAFF_ROLE), "مدير فني", "مدير الكرة"].map((x) => <option key={x} value={x} />)}</datalist>
                </div>
              </fieldset>
              <div style={{ alignSelf: "end" }}><Submit className="btn btn-light">+ إضافة</Submit></div>
            </form>
          )}
          {squad.length === 0 && can && <p className="muted mt">لم تُدخل قوائم الفريقين — أدخلها من تبويب «قوائم الفريقين» لاختيار اللاعبين في الأحداث.</p>}
        </div>
        {canSeeReports(u)
          ? <MatchReportView matchId={m.id} kind="REFEREE" legacy={m.reportNotes ? <div className="mt"><strong style={{ fontSize: ".9rem" }}>ملاحظات الحكم</strong><div className="doc-text">{m.reportNotes}</div></div> : null} />
          : <ConfidentialNote what="تقرير الحكم" />}
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
  const on = dayOf(m.kickoff ?? new Date());
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

async function Officials({ id, canObserver, canAssign, canEvals, canReport, canSanction }: { id: number; canObserver: boolean; canAssign: boolean; canEvals: boolean; canReport: boolean; canSanction: boolean }) {
  const rows = await db.select({ a: assignments, name: officials.fullName }).from(assignments).innerJoin(officials, eq(officials.id, assignments.officialId)).where(eq(assignments.matchId, id));
  const [cr] = await db.select().from(commissionerReports).where(eq(commissionerReports.matchId, id));
  const ev = canEvals ? await db.select({ e: evaluations, name: officials.fullName }).from(evaluations).innerJoin(officials, eq(officials.id, evaluations.officialId)).where(eq(evaluations.matchId, id)) : [];
  return (
    <div className="grid g2">
      <div className="card table-wrap">
        <div className="card-head"><h3>طاقم التحكيم والمراقبة</h3>{canAssign && <Link className="btn btn-sm btn-light" href={`/referees/assignments/${id}`}>تعيين الطاقم</Link>}</div>
        {rows.length === 0 ? <Empty>لم يُعيّن الطاقم بعد</Empty> : (
          <table className="t"><tbody>{rows.map(({ a, name }) => <tr key={a.id}><td>{ASSIGN_ROLE[a.role]}</td><td><strong>{name}</strong></td><td><Badge v={ASSIGN_STATUS[a.status]} />{a.declineReason && <div className="danger-text" style={{ fontSize: ".8rem" }}>اعتذر: {a.declineReason}</div>}</td></tr>)}</tbody></table>
        )}
        {canObserver && <ObserverForm id={id} current={rows.find((r) => OBSERVER_ROLES.includes(r.a.role) && r.a.status !== "DECLINED")?.a.officialId ?? null} />}
      </div>
      <div>
        {canReport ? <>
          <MatchReportView matchId={id} kind="COMMISSIONER" legacy={cr?.isSubmitted ? (
            <dl className="dl">
              <dt>انطلاق فعلي</dt><dd>{cr.actualKickoff}</dd><dt>الحضور</dt><dd>{cr.attendance}</dd><dt>الملعب</dt><dd>{cr.pitch}</dd>
              <dt>التنظيم</dt><dd>{cr.organization}</dd><dt>الأمن والجماهير</dt><dd>{cr.security}</dd><dt>الحوادث</dt><dd>{cr.incidents}</dd><dt>التوصيات</dt><dd>{cr.recommendations}</dd>
            </dl>) : null} />
          {canSanction && <Link className="btn btn-sm btn-danger" href={`/competitions/sanctions/new?match=${id}`}>⚖ تحويل التقرير إلى عقوبة</Link>}
        </> : <ConfidentialNote what="تقرير مراقب المباراة" />}
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

/** تعيين مراقب المباراة — من صلاحية لجنة المسابقات */
async function ObserverForm({ id, current }: { id: number; current: number | null }) {
  const sc = await scopeOf(await getCurrentUser());
  const list = await db.select().from(officials).where(and(eq(officials.status, "ACTIVE"), inArray(officials.type, ["COMMISSIONER", "REF_OBSERVER"]), officialIn(sc, officials.id))).orderBy(officials.fullName);
  return (
    <form action={assignOfficial} className="row mt" style={{ borderTop: "1px solid var(--line)", paddingTop: ".6rem" }}>
      <input type="hidden" name="matchId" value={id} /><input type="hidden" name="role" value="COMMISSIONER" /><input type="hidden" name="back" value={`/matches/${id}?tab=officials`} />
      <strong>مراقب المباراة:</strong>
      <select name="officialId" defaultValue={current ?? ""} style={{ minWidth: 220 }}>
        <option value="">— بدون —</option>
        {list.map((o) => <option key={o.id} value={o.id}>{o.fullName}{o.city ? ` — ${o.city}` : ""}</option>)}
      </select>
      <label className="check" title="تجاوز التحذيرات"><input type="checkbox" name="force" /> تجاوز التحذيرات</label>
      <Submit className="btn btn-sm">تعيين</Submit>
    </form>
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
        <Field label="الملعب" hint="من سجل الملاعب"><input type="text" name="venue" list="stadiums-list" defaultValue={m.venue ?? ""} disabled={!canEdit} /></Field>
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
