import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, asc, inArray } from "drizzle-orm";
import { db } from "@/db";
import { assignments, matches, clubs, competitions, matchSquads, matchEvents, players, officials, evaluations, matchReportForms, reportFiles } from "@/db/schema";
import { getTemplate } from "@/lib/reports";
import { fileUrl } from "@/lib/storage";
import { ReportFields } from "@/components/ReportFields";
import { ReportFileUploader } from "@/components/ReportFileUploader";
import { ObserverReportForm } from "@/components/ObserverReportForm";
import { observerContext } from "@/lib/observerReport";
import { emptyReport } from "@/lib/observerForm";
import { requireOfficialUser } from "@/lib/auth";
import { ASSIGN_ROLE, EVENT_TYPE, REPORT_STATUS, CARD_REASONS } from "@/lib/labels";
import { fmtDateTime } from "@/lib/util";
import { PageHead, Flash, Badge, Field, Options, Empty, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { refAddEvent, refDeleteEvent, refSaveReport, saveEvaluation, saveCommissionerReport, declineAssignment, deleteReportFile } from "../../actions";

export default async function PortalMatch({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const u = await requireOfficialUser();
  const id = Number((await params).id);
  const sp = await searchParams;
  const mine = await db.select().from(assignments).where(and(eq(assignments.matchId, id), eq(assignments.officialId, u.officialId), eq(assignments.status, "APPROVED")));
  if (!mine.length) notFound();
  const [m] = await db.select().from(matches).where(eq(matches.id, id));
  const [c] = await db.select().from(competitions).where(eq(competitions.id, m.competitionId));
  const cl = await db.select().from(clubs).where(inArray(clubs.id, [m.homeClubId, m.awayClubId]));
  const name = (cid: number) => cl.find((x) => x.id === cid)?.name ?? "";
  const crew = await db.select({ a: assignments, name: officials.fullName }).from(assignments).innerJoin(officials, eq(officials.id, assignments.officialId))
    .where(and(eq(assignments.matchId, id), eq(assignments.status, "APPROVED")));
  const roles = mine.map((x) => x.role);
  return (
    <>
      <PageHead title={`${name(m.homeClubId)} × ${name(m.awayClubId)}`} sub={`${c.name} — ج${m.round} — ${fmtDateTime(m.kickoff)} — ${m.venue ?? ""}`}
        crumbs={[["مبارياتي", "/portal"], ["المباراة"]]} actions={<Link className="btn btn-light" href={`/print/match/${id}`} target="_blank">🖨 ورقة المباراة</Link>} />
      <Flash sp={sp} />
      <div className="card">
        <strong>صفتك: </strong>{roles.map((r) => <span key={r} className="b b-indigo" style={{ marginInlineEnd: 6 }}>{ASSIGN_ROLE[r]}</span>)}
        <div className="tag-list mt">{crew.map((x) => <span key={x.a.id} className="b b-gray">{ASSIGN_ROLE[x.a.role]}: {x.name}</span>)}</div>
      </div>
      {roles.includes("REFEREE") && <RefereeReport m={m} name={name} />}
      {roles.includes("COMMISSIONER") && <CommReport matchId={id} />}
      {roles.includes("REF_OBSERVER") && !roles.includes("COMMISSIONER") && <ObserverEval matchId={id} observerId={u.officialId} crew={crew.filter((x) => ["REFEREE", "AR1", "AR2", "FOURTH", "VAR"].includes(x.a.role))} />}
      {!roles.some((r) => ["REFEREE", "REF_OBSERVER", "COMMISSIONER"].includes(r)) && <div className="alert info">لا يُطلب منك تقرير في هذه المباراة — يكتب حكم الساحة تقرير المباراة.</div>}
      {m.status === "SCHEDULED" && (!m.kickoff || m.kickoff.getTime() > Date.now()) && (
        <details className="box card"><summary>الاعتذار عن هذا التعيين</summary>
          <form action={declineAssignment} className="stack mt">
            <input type="hidden" name="matchId" value={id} /><input type="hidden" name="assignmentId" value={mine[0].id} />
            <textarea name="reason" placeholder="سبب الاعتذار (إصابة، ظرف طارئ...)" required />
            <div><Submit className="btn btn-danger" confirm="تأكيد الاعتذار؟ ستُبلغ لجنة الحكام لتعيين بديل.">تأكيد الاعتذار</Submit></div>
          </form>
        </details>
      )}
    </>
  );
}

async function RefereeReport({ m, name }: { m: typeof matches.$inferSelect; name: (id: number) => string }) {
  const squad = await db.select({ s: matchSquads, n: players.fullName }).from(matchSquads).innerJoin(players, eq(players.id, matchSquads.playerId)).where(eq(matchSquads.matchId, m.id)).orderBy(asc(matchSquads.shirtNumber));
  const evs = await db.select({ e: matchEvents, n: players.fullName }).from(matchEvents).leftJoin(players, eq(players.id, matchEvents.playerId)).where(eq(matchEvents.matchId, m.id)).orderBy(asc(matchEvents.minute), asc(matchEvents.id));
  const edit = m.reportStatus === "NONE" || m.reportStatus === "RETURNED";
  const tpl = await getTemplate("REFEREE");
  const [form] = await db.select().from(matchReportForms).where(and(eq(matchReportForms.matchId, m.id), eq(matchReportForms.kind, "REFEREE")));
  return (
    <>
      <div className="card">
        <div className="card-head"><h2>تقرير المباراة (حكم الساحة)</h2><Badge v={REPORT_STATUS[m.reportStatus]} /></div>
        {m.reportStatus === "RETURNED" && <div className="alert warn">أعادت لجنة المسابقات التقرير: {m.reportReturn}</div>}
        {squad.length === 0 && <div className="alert info">لم تُرسل قوائم الفريقين بعد. يمكنك تسجيل الأحداث بدون اختيار اللاعب.</div>}
        <h3>الأحداث</h3>
        {evs.length === 0 ? <Empty>لم تُسجل أحداث</Empty> : (
          <table className="t"><tbody>{evs.map(({ e, n }) => (
            <tr key={e.id}><td className="num">{e.minute ? `${e.minute}'` : ""}</td><td>{EVENT_TYPE[e.type]}</td><td><strong>{n ?? "—"}</strong></td><td>{name(e.clubId)}</td><td className="muted">{e.note}</td>
              <td>{edit && <form action={refDeleteEvent}><input type="hidden" name="matchId" value={m.id} /><input type="hidden" name="eventId" value={e.id} /><Submit className="btn btn-sm btn-ghost">✕</Submit></form>}</td></tr>
          ))}</tbody></table>
        )}
        {edit && (
          <form action={refAddEvent} className="form f3 mt">
            <input type="hidden" name="matchId" value={m.id} />
            <Field label="الحدث"><select name="type"><Options map={EVENT_TYPE} /></select></Field>
            <Field label="الدقيقة"><input type="number" name="minute" min={0} max={130} /></Field>
            <Field label="الفريق"><select name="clubId"><option value={m.homeClubId}>{name(m.homeClubId)}</option><option value={m.awayClubId}>{name(m.awayClubId)}</option></select></Field>
            <Field label="اللاعب">
              <select name="playerId"><option value="">—</option>
                {[m.homeClubId, m.awayClubId].map((cid) => <optgroup key={cid} label={name(cid)}>{squad.filter((s) => s.s.clubId === cid).map((s) => <option key={s.s.playerId} value={s.s.playerId}>{s.s.shirtNumber ? `${s.s.shirtNumber} - ` : ""}{s.n}</option>)}</optgroup>)}
              </select>
            </Field>
            <Field label="ملاحظة"><input type="text" name="note" /></Field>
            <div style={{ alignSelf: "end" }}><Submit className="btn btn-light">+ إضافة حدث</Submit></div>
          </form>
        )}
      </div>
      <form action={refSaveReport} className="card">
        <input type="hidden" name="matchId" value={m.id} />
        <h3>النتيجة والملاحظات</h3>
        <div className="row" style={{ justifyContent: "center", margin: "1rem 0" }}>
          <strong>{name(m.homeClubId)}</strong>
          <input className="score-in" type="number" name="homeScore" min={0} defaultValue={m.homeScore ?? ""} disabled={!edit} /> :
          <input className="score-in" type="number" name="awayScore" min={0} defaultValue={m.awayScore ?? ""} disabled={!edit} />
          <strong>{name(m.awayClubId)}</strong>
        </div>
        <div className="form">
          <Field label="الحضور الجماهيري التقريبي"><input type="number" name="attendance" defaultValue={m.attendance ?? ""} disabled={!edit} /></Field>
        </div>
        <h3 className="mt">{tpl.title}</h3>
        <ReportFields fields={form?.isSubmitted && !edit ? form.fields : tpl.fields} answers={form?.answers ?? {}} disabled={!edit} />
        {edit && <div className="btn-row mt"><Submit className="btn btn-light" name="submit" value="0">💾 حفظ مسودة</Submit><Submit name="submit" value="1" confirm="إرسال التقرير للجنة المسابقات؟ لن تتمكن من التعديل بعد الإرسال.">📤 إرسال التقرير</Submit></div>}
      </form>
      <Attachments matchId={m.id} kind="REFEREE" edit={edit} required={tpl.requireAttachment} />
    </>
  );
}

async function ObserverEval({ matchId, observerId, crew }: { matchId: number; observerId: number; crew: { a: typeof assignments.$inferSelect; name: string }[] }) {
  const ev = await db.select().from(evaluations).where(and(eq(evaluations.matchId, matchId), eq(evaluations.observerId, observerId)));
  const sent = ev.some((e) => e.isSubmitted);
  const sub = (k: string, id: number, v: number | null | undefined, label: string) => (
    <Field label={label}><input type="number" name={`${k}_${id}`} min={1} max={10} defaultValue={v ?? ""} disabled={sent} /></Field>
  );
  return (
    <form action={saveEvaluation} className="card">
      <input type="hidden" name="matchId" value={matchId} />
      <div className="card-head"><h2>تقييم طاقم التحكيم</h2>{sent && <span className="b b-green">مُرسل</span>}</div>
      <p className="muted">الدرجة العامة من 10 (مثال 8.4). العناصر الفرعية من 1 إلى 10. تُستخدم الدرجات لترتيب الحكام وترقيتهم.</p>
      {crew.map(({ a, name }) => {
        const e = ev.find((x) => x.officialId === a.officialId);
        return (
          <details key={a.id} className="box" open>
            <summary>{ASSIGN_ROLE[a.role]}: {name} {e && <span className="b b-indigo">{e.score}</span>}</summary>
            <div className="form f3 mt">
              <Field label="الدرجة العامة *"><input type="number" step="0.1" min={0} max={10} name={`score_${a.officialId}`} defaultValue={e?.score ?? ""} disabled={sent} /></Field>
              {sub("pos", a.officialId, e?.positioning, "التمركز والتحرك")}
              {sub("fit", a.officialId, e?.fitness, "اللياقة البدنية")}
              {sub("dec", a.officialId, e?.decisions, "صحة القرارات")}
              {sub("ctl", a.officialId, e?.control, "السيطرة على المباراة")}
              <Field label="ملاحظات" full><textarea name={`notes_${a.officialId}`} defaultValue={e?.notes ?? ""} disabled={sent} /></Field>
            </div>
          </details>
        );
      })}
      {!sent && <div className="btn-row mt"><Submit className="btn btn-light" name="submit" value="0">💾 حفظ مسودة</Submit><Submit name="submit" value="1" confirm="إرسال التقييم نهائيًا؟">📤 إرسال التقييم</Submit></div>}
    </form>
  );
}

async function CommReport({ matchId }: { matchId: number }) {
  const tpl = await getTemplate("COMMISSIONER");
  const [r] = await db.select().from(matchReportForms).where(and(eq(matchReportForms.matchId, matchId), eq(matchReportForms.kind, "COMMISSIONER")));
  const ctx = (await observerContext(matchId))!;
  const dis = !!r?.isSubmitted;
  const init = r?.data ?? { ...emptyReport(), ft: [ctx.m.homeScore?.toString() ?? "", ctx.m.awayScore?.toString() ?? ""] as [string, string] };
  return (
    <>
      <form action={saveCommissionerReport} className="card">
        <input type="hidden" name="matchId" value={matchId} />
        <div className="card-head"><h2>تقرير مراقب المباراة (يُرسل للجنة المسابقات)</h2>
          <div className="row">{dis && <span className="b b-green">مُرسل</span>}<Link className="btn btn-sm btn-light" href={`/print/observer/${matchId}`} target="_blank">🖨 طباعة التقرير</Link></div></div>
        <dl className="dl" style={{ fontSize: ".9rem" }}>
          <dt>المسابقة</dt><dd>{ctx.comp} — الموسم {ctx.season}</dd>
          <dt>الأسبوع</dt><dd>{ctx.round ?? "—"} — رقم المباراة بالجدول ({ctx.no})</dd>
          <dt>المراقب</dt><dd>{ctx.observer?.name} — {ctx.observer?.grade}</dd>
          <dt>المباراة</dt><dd>{ctx.home.name} × {ctx.away.name}</dd>
          <dt>الملعب</dt><dd>{ctx.stadium || "—"} — {fmtDateTime(ctx.m.kickoff)}</dd>
        </dl>
        {!r?.data && r?.isSubmitted && r.fields.length > 0 && <ReportFields fields={r.fields} answers={r.answers} disabled />}
        {(r?.data || !dis) && <ObserverReportForm initial={init} home={ctx.home} away={ctx.away} squad={ctx.squad} crew={ctx.crew} category={ctx.category} reasons={CARD_REASONS} disabled={dis} />}
        {!dis && <div className="btn-row mt"><Submit className="btn btn-light" name="submit" value="0">💾 حفظ مسودة</Submit><Submit name="submit" value="1" confirm="إرسال التقرير نهائيًا للجنة المسابقات؟ لن تتمكن من التعديل بعد الإرسال.">📤 إرسال التقرير</Submit></div>}
      </form>
      <Attachments matchId={matchId} kind="COMMISSIONER" edit={!dis} required={tpl.requireAttachment} />
    </>
  );
}

/** مرفقات التقرير (التقرير الورقي صورةً أو PDF) */
async function Attachments({ matchId, kind, edit, required }: { matchId: number; kind: "REFEREE" | "COMMISSIONER"; edit: boolean; required: boolean }) {
  const files = await db.select().from(reportFiles).where(and(eq(reportFiles.matchId, matchId), eq(reportFiles.kind, kind))).orderBy(asc(reportFiles.id));
  return (
    <div className="card">
      <h3>📎 مرفقات التقرير{required && <span className="danger-text" style={{ fontSize: ".85rem" }}> — إلزامية قبل الإرسال</span>}</h3>
      {files.length === 0 ? <p className="muted">لا مرفقات</p> : (
        <table className="t"><tbody>{files.map((x) => (
          <tr key={x.id}><td><a href={fileUrl(x.fileKey)!} target="_blank" rel="noreferrer">{x.mime.startsWith("image/") ? "🖼" : "📄"} {x.originalName}</a></td>
            <td style={{ width: 80 }}>{edit && <form action={deleteReportFile}><input type="hidden" name="matchId" value={matchId} /><input type="hidden" name="id" value={x.id} /><Submit className="btn btn-sm btn-ghost" confirm="حذف المرفق؟">حذف</Submit></form>}</td></tr>
        ))}</tbody></table>
      )}
      {edit && <ReportFileUploader matchId={matchId} kind={kind} />}
    </div>
  );
}
