import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, desc, and } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { players, registrations, clubs, seasons, suspensions, matchEvents, matches, competitions } from "@/db/schema";
import { scopeOf, clubIn, regIn, guardPage, inScopeReg, inScopePlayer } from "@/lib/scope";
import { requireUser } from "@/lib/auth";
import { REG_STATUS, REG_TYPE, PLAYER_STATUS, EVENT_TYPE } from "@/lib/labels";
import { fmtDate, fmtDateTime, today } from "@/lib/util";
import { fileUrl } from "@/lib/storage";
import { PageHead, Flash, Badge, Field, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { PlayerFields } from "@/components/PlayerForm";
import { editPlayer, setPlayerStatus, addSuspension, liftSuspension } from "../../actions";

export default async function PlayerFile({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const u = await requireUser("reg.view", "comp.view");
  const id = Number((await params).id);
  const sp = await searchParams;
  const [p] = await db.select().from(players).where(eq(players.id, id));
  if (!p) notFound();
  guardPage(await inScopePlayer(u, id));
  const fc = alias(clubs, "fc");
  const [regs, susp, evs] = await Promise.all([
    db.select({ r: registrations, club: clubs.name, from: fc.name, season: seasons.name }).from(registrations)
      .innerJoin(clubs, eq(clubs.id, registrations.clubId)).innerJoin(seasons, eq(seasons.id, registrations.seasonId)).leftJoin(fc, eq(fc.id, registrations.fromClubId))
      .where(eq(registrations.playerId, id)).orderBy(desc(registrations.id)),
    db.select().from(suspensions).where(eq(suspensions.playerId, id)).orderBy(desc(suspensions.id)),
    db.select({ e: matchEvents, m: matches, comp: competitions.name }).from(matchEvents).innerJoin(matches, eq(matches.id, matchEvents.matchId))
      .innerJoin(competitions, eq(competitions.id, matches.competitionId))
      .where(and(eq(matchEvents.playerId, id), eq(matches.reportStatus, "APPROVED"))).orderBy(desc(matches.kickoff)).limit(100),
  ]);
  const t = today();
  const isActive = (s: (typeof susp)[number]) => !s.isLifted && (s.kind === "ADMIN" ? !s.endDate || s.endDate >= t : (s.matchesTotal ?? 0) > s.matchesServed);
  const back = `/registration/players/${id}`;
  return (
    <>
      <PageHead title={p.fullName} sub={<>الرقم الوطني <span className="kbd">{p.nationalId ?? "—"}</span> — مواليد {fmtDate(p.dateOfBirth)}</>} crumbs={[["سجل اللاعبين", "/registration/players"], [p.fullName]]}
        actions={u.can("archive.view") ? <Link className="btn btn-light" href={`/archive?player=${p.id}`}>🗄 وثائق اللاعب في الأرشيف</Link> : undefined} />
      <Flash sp={sp} />
      <div className="grid g-side">
        <div>
          <div className="card row" style={{ alignItems: "flex-start", gap: "1.2rem" }}>
            {p.photoKey ? <img className="photo-lg" src={fileUrl(p.photoKey)!} alt="" /> : <div className="photo-lg ph" style={{ width: 130, height: 160 }}>👤</div>}
            <div>
              <Badge v={PLAYER_STATUS[p.status]} /> {p.isForeign && <span className="b b-purple">أجنبي</span>}
              <p className="muted">{p.nationality} — {p.placeOfBirth ?? ""}</p>
              {p.notes && <p>{p.notes}</p>}
              <div className="tag-list">
                <span className="b b-gray">أهداف: {evs.filter((x) => ["GOAL", "PENALTY_GOAL"].includes(x.e.type)).length}</span>
                <span className="b b-amber">إنذارات: {evs.filter((x) => x.e.type === "YELLOW").length}</span>
                <span className="b b-red">طرد: {evs.filter((x) => ["RED", "SECOND_YELLOW"].includes(x.e.type)).length}</span>
              </div>
            </div>
          </div>
          <div className="card table-wrap">
            <h2>سجل القيد والانتقالات</h2>
            <table className="t"><thead><tr><th>الموسم</th><th>النادي</th><th>النوع</th><th>من</th><th>رقم القيد</th><th>الحالة</th><th>البطاقة</th><th></th></tr></thead>
              <tbody>{regs.map(({ r, club, from, season }) => (
                <tr key={r.id}><td>{season}</td><td>{club}</td><td>{REG_TYPE[r.type]}</td><td>{from ?? "—"}</td><td className="kbd">{r.number ?? "—"}</td>
                  <td><Badge v={REG_STATUS[r.status]} /></td><td>{r.cardPrintCount ? `طُبعت ${r.cardPrintCount}` : "—"}</td>
                  <td><Link href={`/registration/requests/${r.id}`}>عرض</Link></td></tr>
              ))}</tbody></table>
          </div>
          <div className="card table-wrap">
            <h2>الإيقافات</h2>
            {susp.length === 0 ? <p className="muted">لا توجد إيقافات</p> : (
              <table className="t"><thead><tr><th>النوع</th><th>السبب</th><th>المدة</th><th>الحالة</th><th></th></tr></thead>
                <tbody>{susp.map((s) => (
                  <tr key={s.id} className={isActive(s) ? "danger" : ""}>
                    <td>{s.kind === "ADMIN" ? "إداري" : "مباريات"}{s.isAutomatic && " (تلقائي)"}</td><td>{s.reason}</td>
                    <td>{s.kind === "ADMIN" ? `${fmtDate(s.startDate)} ← ${s.endDate ? fmtDate(s.endDate) : "مفتوح"}` : `${s.matchesServed} / ${s.matchesTotal} مباراة`}</td>
                    <td>{s.isLifted ? <span className="b b-gray">مرفوع</span> : isActive(s) ? <span className="b b-red">ساري</span> : <span className="b b-green">منتهٍ</span>}</td>
                    <td>{isActive(s) && u.can(s.kind === "ADMIN" ? "reg.suspend" : "comp.suspend") && (
                      <form action={liftSuspension}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="back" value={back} /><Submit className="btn btn-sm btn-light" confirm="رفع الإيقاف؟">رفع</Submit></form>)}</td>
                  </tr>))}</tbody></table>
            )}
          </div>
          <div className="card table-wrap">
            <h2>سجل المباريات</h2>
            {evs.length === 0 ? <p className="muted">لا أحداث مسجلة</p> : (
              <table className="t"><tbody>{evs.map(({ e, m, comp }) => (
                <tr key={e.id}><td>{fmtDateTime(m.kickoff)}</td><td>{comp} — ج{m.round}</td><td>{EVENT_TYPE[e.type]}</td><td>{e.minute ? `د ${e.minute}` : ""}</td><td><Link href={`/matches/${m.id}`}>المباراة</Link></td></tr>
              ))}</tbody></table>
            )}
          </div>
        </div>
        <div>
          {u.can("reg.suspend") && (
            <details className="box card">
              <summary>⛔ إيقاف إداري</summary>
              <form action={addSuspension} className="form f1 mt">
                <input type="hidden" name="playerId" value={id} /><input type="hidden" name="kind" value="ADMIN" /><input type="hidden" name="back" value={back} />
                <Field label="السبب"><textarea name="reason" required /></Field>
                <Field label="من"><input type="date" name="startDate" defaultValue={t} /></Field>
                <Field label="إلى (فارغ = حتى إشعار آخر)"><input type="date" name="endDate" /></Field>
                <Submit className="btn btn-danger">تسجيل الإيقاف</Submit>
              </form>
            </details>
          )}
          {u.can("reg.edit") && (
            <details className="box card">
              <summary>حالة اللاعب</summary>
              <form action={setPlayerStatus} className="form f1 mt">
                <input type="hidden" name="playerId" value={id} />
                <Field label="الحالة"><select name="status" defaultValue={p.status}>{Object.entries(PLAYER_STATUS).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</select></Field>
                <Field label="ملاحظات"><textarea name="notes" defaultValue={p.notes ?? ""} /></Field>
                <Submit>حفظ</Submit>
              </form>
            </details>
          )}
          {u.can("reg.edit") && (
            <details className="box card">
              <summary>✎ تعديل بيانات اللاعب</summary>
              <form action={editPlayer} className="form f1 mt">
                <input type="hidden" name="playerId" value={id} />
                <PlayerFields p={p} />
                <Submit>حفظ التعديلات</Submit>
              </form>
            </details>
          )}
        </div>
      </div>
    </>
  );
}
