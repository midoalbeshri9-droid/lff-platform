import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { sanctions, clubs, players, staff, competitions, matches, appeals, charges } from "@/db/schema";
import { guardPage, inScopeSanction } from "@/lib/scope";
import { requireUser } from "@/lib/auth";
import { SANCTION_TYPE, SANCTION_TARGET, SANCTION_STATUS, APPEAL_STATUS, CHARGE_STATUS } from "@/lib/labels";
import { fmtDate, fmtDateTime, money } from "@/lib/util";
import { fileUrl } from "@/lib/storage";
import { PageHead, Flash, Badge, Field, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { revoke, amend, markCompleted, decideAppeal } from "../actions";

export default async function SanctionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const u = await requireUser("comp.view", "comp.sanctions");
  const id = Number((await params).id);
  const sp = await searchParams;
  const [row] = await db.select({ s: sanctions, club: clubs.name, player: players.fullName, staffName: staff.fullName, comp: competitions.name })
    .from(sanctions).innerJoin(clubs, eq(clubs.id, sanctions.clubId)).leftJoin(players, eq(players.id, sanctions.playerId))
    .leftJoin(staff, eq(staff.id, sanctions.staffId)).leftJoin(competitions, eq(competitions.id, sanctions.competitionId)).where(eq(sanctions.id, id));
  guardPage(await inScopeSanction(u, id));
  if (!row) notFound();
  const { s } = row;
  const [m] = s.matchId ? await db.select().from(matches).where(eq(matches.id, s.matchId)) : [];
  const aps = await db.select().from(appeals).where(eq(appeals.sanctionId, id)).orderBy(desc(appeals.id));
  const [ch] = s.chargeId ? await db.select().from(charges).where(eq(charges.id, s.chargeId)) : [];
  const can = u.can("comp.sanctions");
  const pending = aps.find((a) => a.status === "PENDING");
  const amendFields = (
    <>
      {s.matchesCount != null && <Field label="عدد المباريات"><input type="number" name="matchesCount" defaultValue={s.matchesCount} /></Field>}
      {s.toDate && <Field label="حتى تاريخ"><input type="date" name="toDate" defaultValue={s.toDate} /></Field>}
      {s.points != null && <Field label="النقاط"><input type="number" name="points" defaultValue={s.points} /></Field>}
      <Field label="الغرامة"><input type="number" step="0.01" name="fineAmount" defaultValue={s.fineAmount ?? ""} /></Field>
    </>
  );
  return (
    <>
      <PageHead title={`القرار ${s.number}`} sub={<>{SANCTION_TYPE[s.type]} — <Badge v={SANCTION_STATUS[s.status]} /></>} crumbs={[["العقوبات", "/competitions/sanctions"], [s.number]]}
        actions={<Link className="btn btn-light" href={`/print/sanction/${id}`} target="_blank">🖨 طباعة القرار</Link>} />
      <Flash sp={sp} />
      <div className="grid g-side">
        <div>
          <div className="card">
            <dl className="dl">
              <dt>المعاقَب</dt><dd>{s.targetType === "CLUB" ? row.club : `${row.player ?? row.staffName} (${SANCTION_TARGET[s.targetType]}) — ${row.club}`}</dd>
              <dt>العقوبة</dt><dd><strong>{SANCTION_TYPE[s.type]}</strong></dd>
              {s.matchesCount != null && (<><dt>المباريات</dt><dd>{s.matchesCount}</dd></>)}
              {(s.fromDate || s.toDate) && (<><dt>المدة</dt><dd>{fmtDate(s.fromDate)} ← {fmtDate(s.toDate)}</dd></>)}
              {s.points != null && (<><dt>خصم النقاط</dt><dd>{s.points} نقطة من رصيد النادي في {row.comp}</dd></>)}
              {Number(s.fineAmount) > 0 && (<><dt>الغرامة</dt><dd>{money(s.fineAmount)} {ch && <Badge v={CHARGE_STATUS[ch.status]} />}</dd></>)}
              <dt>المسابقة</dt><dd>{row.comp ?? "—"}</dd>
              {m && (<><dt>المباراة</dt><dd><Link href={`/matches/${m.id}`}>الجولة {m.round} — {fmtDateTime(m.kickoff)}</Link></dd></>)}
              <dt>السند</dt><dd>{s.articleText ?? "—"}</dd>
              <dt>تاريخ القرار</dt><dd>{fmtDate(s.decisionDate)}</dd>
              <dt>مهلة الطعن</dt><dd>حتى {fmtDate(s.appealDeadline)}</dd>
              <dt>أصدره</dt><dd>{s.createdBy}</dd>
            </dl>
            <h3 className="mt">الوقائع والأسباب</h3>
            <div className="doc-text">{s.reason}</div>
            {s.notes && <p className="muted mt">{s.notes}</p>}
          </div>
          <div className="card">
            <h3>الطعون</h3>
            {aps.length === 0 ? <p className="muted">لا توجد طعون</p> : aps.map((a) => (
              <div key={a.id} className="opinion">
                <div className="who">{a.submittedBy} — {fmtDateTime(a.submittedAt)} <Badge v={APPEAL_STATUS[a.status]} /></div>
                <div className="pre">{a.text}</div>
                {a.documentKey && <a href={fileUrl(a.documentKey)!} target="_blank">📎 مستند الطعن</a>}
                {a.decision && <div className="alert info mt mb0"><strong>القرار:</strong> {a.decision} — {a.decidedBy}</div>}
              </div>
            ))}
            {pending && can && (
              <form action={decideAppeal} className="form mt">
                <input type="hidden" name="id" value={id} /><input type="hidden" name="appealId" value={pending.id} />
                <Field label="نص القرار في الطعن *" full><textarea name="decisionText" required /></Field>
                <p className="muted full mb0" style={{ fontSize: ".85rem" }}>عند «قبول جزئي» تُطبق القيم التالية بعد التخفيف:</p>
                {amendFields}
                <div className="btn-row full">
                  <Submit name="decision" value="ACCEPTED" confirm="قبول الطعن وإلغاء العقوبة؟">✓ قبول (إلغاء العقوبة)</Submit>
                  <Submit name="decision" value="REDUCED" className="btn btn-gold">قبول جزئي (تخفيف)</Submit>
                  <Submit name="decision" value="REJECTED" className="btn btn-danger">✗ رفض الطعن</Submit>
                </div>
              </form>
            )}
          </div>
        </div>
        <div>
          {can && s.status !== "REVOKED" && (
            <>
              <details className="box card"><summary>تعديل العقوبة</summary>
                <form action={amend} className="form f1 mt"><input type="hidden" name="id" value={id} />{amendFields}<Submit>حفظ</Submit></form>
              </details>
              {s.status === "ACTIVE" && <form action={markCompleted} className="card"><input type="hidden" name="id" value={id} /><Submit className="btn btn-light w100">تعليمها كمنفّذة</Submit></form>}
              <details className="box card"><summary>إلغاء القرار</summary>
                <form action={revoke} className="stack mt"><input type="hidden" name="id" value={id} /><textarea name="reason" placeholder="سبب الإلغاء" required />
                  <Submit className="btn btn-danger" confirm="إلغاء القرار وكل آثاره (الإيقاف، الغرامة، النقاط)؟">إلغاء القرار</Submit></form>
              </details>
            </>
          )}
          <div className="card">
            <h3>الآثار المطبقة</h3>
            <ul style={{ paddingInlineStart: "1.2rem", margin: 0, fontSize: ".9rem" }}>
              {s.suspensionId && <li>إيقاف مسجل يمنع إشراك اللاعب في القوائم</li>}
              {s.type === "POINTS_DEDUCTION" && <li>خصم {s.points} نقطة يظهر في جدول الترتيب</li>}
              {s.type === "FORFEIT" && <li>المباراة محتسبة 0-3</li>}
              {s.type === "REGISTRATION_BAN" && <li>النادي ممنوع من إرسال طلبات القيد حتى {fmtDate(s.toDate)}</li>}
              {s.chargeId && <li>غرامة مسجلة في حساب النادي لدى اللجنة المالية</li>}
              {(s.type === "CLOSED_DOORS" || s.type === "VENUE_CHANGE") && <li>تظهر في صفحة المباراة وورقتها</li>}
              {s.type === "WARNING" && <li>إنذار مسجل في ملف المعاقَب</li>}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
