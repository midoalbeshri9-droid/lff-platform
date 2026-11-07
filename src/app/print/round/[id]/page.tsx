import { redirect } from "next/navigation";
import { and, eq, inArray, asc, desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { competitions, competitionStages, matches, clubs, matchEvents, players, suspensions, sanctions, assignments, officials, registrations } from "@/db/schema";
import { inScopeComp } from "@/lib/scope";
import { getCurrentUser } from "@/lib/auth";
import { standings } from "@/lib/competition";
import { ensureStages } from "@/lib/stages";
import { koRoundName } from "@/lib/competitionPure";
import { SANCTION_TYPE, ASSIGN_ROLE } from "@/lib/labels";
import { fmtDate, fmtDateTime } from "@/lib/util";
import { PrintButton } from "@/components/Client";
import { Letterhead } from "@/components/Letterhead";

const GOALS = ["GOAL", "PENALTY_GOAL", "OWN_GOAL"];
const CARDS = ["YELLOW", "SECOND_YELLOW", "RED"];
const ROLE_ORDER = ["REFEREE", "AR1", "AR2", "FOURTH", "VAR", "COMMISSIONER", "REF_OBSERVER"];

/** التقرير الأسبوعي للجولة: النتائج، الهدافون، البطاقات، الإيقافات، العقوبات، الترتيب بعد الجولة، الطواقم، مباريات الجولة القادمة */
export default async function RoundReport({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ stage?: string; round?: string }> }) {
  const u = await getCurrentUser();
  if (!u?.can("comp.view") || u.isClub || u.isOfficial) redirect("/denied");
  const id = Number((await params).id);
  if (!(await inScopeComp(u, id))) redirect("/denied");
  const sp = await searchParams;
  const [c] = await db.select().from(competitions).where(eq(competitions.id, id));
  if (!c) redirect("/competitions");
  const stages = await ensureStages(id);
  const roundsBy = await db.select({ stage: matches.stageId, round: matches.round, played: sql<number>`count(*) filter (where ${matches.status} in ('PLAYED','FORFEIT'))::int` })
    .from(matches).where(eq(matches.competitionId, id)).groupBy(matches.stageId, matches.round).orderBy(matches.stageId, matches.round);
  // الافتراضي: آخر جولة لُعبت فيها مباراة
  const lastPlayed = [...roundsBy].reverse().find((r) => r.played > 0) ?? roundsBy[0];
  const stageId = Number(sp.stage) || lastPlayed?.stage || stages[0]?.id;
  const st = stages.find((x) => x.id === stageId) ?? stages[0];
  const stRounds = roundsBy.filter((r) => r.stage === st?.id).map((r) => r.round);
  const round = Number(sp.round) || (lastPlayed?.stage === st?.id ? lastPlayed.round : stRounds[0]) || 1;
  const ko = st?.format === "KNOCKOUT";

  const name = new Map((await db.select({ id: clubs.id, name: clubs.name }).from(clubs)).map((x) => [x.id, x.name]));
  const ms = st ? await db.select().from(matches).where(and(eq(matches.stageId, st.id), eq(matches.round, round))).orderBy(asc(matches.kickoff), asc(matches.id)) : [];
  const ids = ms.map((m) => m.id);
  const next = st ? await db.select().from(matches).where(and(eq(matches.stageId, st.id), eq(matches.round, round + 1))).orderBy(asc(matches.kickoff), asc(matches.id)) : [];
  const evs = ids.length ? await db.select({ e: matchEvents, player: players.fullName }).from(matchEvents).leftJoin(players, eq(players.id, matchEvents.playerId))
    .where(and(inArray(matchEvents.matchId, ids), inArray(matchEvents.type, [...GOALS, ...CARDS] as ("GOAL")[]))).orderBy(asc(matchEvents.matchId), asc(matchEvents.minute)) : [];
  const crewIds = [...ids, ...next.map((m) => m.id)];
  const crews = crewIds.length ? await db.select({ a: assignments, name: officials.fullName }).from(assignments).innerJoin(officials, eq(officials.id, assignments.officialId))
    .where(and(inArray(assignments.matchId, crewIds), inArray(assignments.status, ["DRAFT", "APPROVED"]))) : [];
  const newSusp = ids.length ? await db.select({ s: suspensions, player: players.fullName }).from(suspensions).innerJoin(players, eq(players.id, suspensions.playerId))
    .where(and(inArray(suspensions.sourceMatchId, ids), eq(suspensions.isLifted, false))) : [];
  const roundSanctions = ids.length ? await db.select({ s: sanctions, player: players.fullName }).from(sanctions).leftJoin(players, eq(players.id, sanctions.playerId))
    .where(and(inArray(sanctions.matchId, ids), inArray(sanctions.status, ["ACTIVE", "APPEALED", "COMPLETED"] as ("ACTIVE")[]))).orderBy(sanctions.number) : [];
  const susNow = await db.select({ s: suspensions, player: players.fullName }).from(suspensions).innerJoin(players, eq(players.id, suspensions.playerId))
    .where(and(eq(suspensions.competitionId, id), eq(suspensions.kind, "MATCHES"), eq(suspensions.isLifted, false), sql`${suspensions.matchesTotal} > ${suspensions.matchesServed}`));
  const pids = [...new Set([...susNow, ...newSusp].map((x) => x.s.playerId))];
  const regs = pids.length ? await db.select({ p: registrations.playerId, club: registrations.clubId }).from(registrations)
    .where(and(inArray(registrations.playerId, pids), eq(registrations.status, "APPROVED"), eq(registrations.seasonId, c.seasonId))).orderBy(desc(registrations.id)) : [];
  const clubOf = (pid: number) => name.get(regs.find((r) => r.p === pid)?.club ?? 0) ?? "";
  const table = st && !ko ? await standings(id, st.id, { uptoRound: round }) : [];
  const groups = [...new Set(table.map((r) => r.group ?? ""))];
  const teams = (m: typeof matches.$inferSelect) => `${name.get(m.homeClubId)} × ${name.get(m.awayClubId)}`;
  const score = (m: typeof matches.$inferSelect) => m.homeScore == null ? "—" : `${m.homeScore} - ${m.awayScore}${m.homePens != null ? ` (ترجيح ${m.homePens}-${m.awayPens})` : ""}`;
  const crewOf = (mid: number) => crews.filter((x) => x.a.matchId === mid).sort((a, b) => ROLE_ORDER.indexOf(a.a.role) - ROLE_ORDER.indexOf(b.a.role));
  const days = ms.map((m) => m.kickoff).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime());
  const label = ko ? koRoundName(new Set(ms.filter((m) => !m.isThirdPlace).map((m) => m.tieNo)).size * 2, round) : `الجولة ${round}`;
  const nextLabel = ko ? "الدور التالي" : `الجولة ${round + 1}`;
  // الهدافون في الجولة ومجموعهم
  const scorers = new Map<string, { player: string; club: string; n: number }>();
  for (const { e, player } of evs) if (e.type !== "OWN_GOAL" && GOALS.includes(e.type) && player) {
    const k = `${e.playerId}`; const x = scorers.get(k) ?? { player, club: name.get(e.clubId) ?? "", n: 0 }; x.n++; scorers.set(k, x);
  }
  const H = ({ children }: { children: React.ReactNode }) => <h3 style={{ margin: "14px 0 6px", fontSize: "1rem", borderBottom: "2px solid #c9a227", paddingBottom: 2 }}>{children}</h3>;
  const none = <p style={{ fontSize: ".85rem", color: "#666", margin: "2px 0" }}>لا يوجد</p>;

  return (
    <div className="print-root">
      <div className="print-toolbar no-print">
        <form method="get" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select name="stage" defaultValue={st?.id}>{stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select name="round" defaultValue={round}>{stRounds.map((r) => <option key={r} value={r}>الجولة {r}</option>)}</select>
          <button className="btn btn-light">عرض</button>
        </form>
        <PrintButton />
      </div>
      <div className="sheet">
        <Letterhead sub="لجنة المسابقات" subEn="Competitions Committee" />
        <h1 className="doc-title">التقرير الأسبوعي — {c.name}{stages.length > 1 && st ? ` — ${st.name}` : ""} — {label}</h1>
        <div className="meta-line"><span>{days.length ? (days[0] === days[days.length - 1] ? fmtDate(days[0]) : `من ${fmtDate(days[0])} إلى ${fmtDate(days[days.length - 1])}`) : ""}</span><span>تاريخ الإصدار {fmtDate(new Date())}</span></div>

        <H>أولًا: نتائج المباريات</H>
        {ms.length === 0 ? none : (
          <table className="roster-table"><thead><tr><th>#</th>{st?.format === "GROUPS" && <th>المجموعة</th>}<th>المباراة</th><th>النتيجة</th><th>التاريخ</th><th>الملعب</th><th>الحالة</th></tr></thead>
            <tbody>{ms.map((m, i) => <tr key={m.id}><td>{i + 1}</td>{st?.format === "GROUPS" && <td>{m.groupName}</td>}<td className="l">{teams(m)}</td><td><strong>{score(m)}</strong></td><td>{fmtDateTime(m.kickoff)}</td><td>{m.venue}</td>
              <td>{m.status === "FORFEIT" ? "اعتبارية" : m.status === "POSTPONED" ? "مؤجلة" : m.status === "CANCELLED" ? "ملغاة" : m.status === "PLAYED" ? (m.reportStatus === "APPROVED" ? "معتمدة" : "بانتظار الاعتماد") : m.reportStatus === "SUBMITTED" ? "بانتظار الاعتماد" : "لم تُلعب"}</td></tr>)}</tbody></table>
        )}

        <H>ثانيًا: الأهداف والهدافون</H>
        {evs.filter((x) => GOALS.includes(x.e.type)).length === 0 ? none : (
          <table className="roster-table"><thead><tr><th>المباراة</th><th>الهدافون</th></tr></thead>
            <tbody>{ms.map((m) => { const g = evs.filter((x) => x.e.matchId === m.id && GOALS.includes(x.e.type)); return g.length ? (
              <tr key={m.id}><td className="l" style={{ width: "35%" }}>{teams(m)}</td><td className="l">{g.map(({ e, player }) => `${player ?? "—"} (${name.get(e.clubId)}${e.minute ? ` ${e.minute}'` : ""}${e.type === "PENALTY_GOAL" ? " ج" : e.type === "OWN_GOAL" ? " عكسي" : ""})`).join("، ")}</td></tr>) : null; })}</tbody></table>
        )}
        {scorers.size > 0 && <p style={{ fontSize: ".82rem", margin: "4px 0" }}>أكثر من سجّل في الجولة: {[...scorers.values()].sort((a, b) => b.n - a.n).filter((x, _, arr) => x.n === arr[0].n).map((x) => `${x.player} — ${x.club} (${x.n})`).join("، ")}</p>}

        <H>ثالثًا: البطاقات الصفراء والحمراء</H>
        {evs.filter((x) => CARDS.includes(x.e.type)).length === 0 ? none : (
          <table className="roster-table"><thead><tr><th>اللاعب</th><th>النادي</th><th>البطاقة</th><th>الدقيقة</th><th>المباراة</th></tr></thead>
            <tbody>{evs.filter((x) => CARDS.includes(x.e.type)).sort((a, b) => CARDS.indexOf(b.e.type) - CARDS.indexOf(a.e.type)).map(({ e, player }) => {
              const m = ms.find((x) => x.id === e.matchId)!;
              return <tr key={e.id}><td className="l">{player ?? "—"}</td><td>{name.get(e.clubId)}</td><td>{e.type === "YELLOW" ? "🟨 صفراء" : e.type === "SECOND_YELLOW" ? "🟨🟥 صفراء ثانية" : "🟥 حمراء مباشرة"}</td><td>{e.minute ?? ""}</td><td>{teams(m)}</td></tr>;
            })}</tbody></table>
        )}

        <H>رابعًا: الإيقافات الناتجة عن الجولة</H>
        {newSusp.length === 0 ? none : (
          <table className="roster-table"><thead><tr><th>اللاعب</th><th>النادي</th><th>السبب</th><th>عدد المباريات</th></tr></thead>
            <tbody>{newSusp.map(({ s, player }) => <tr key={s.id}><td className="l">{player}</td><td>{clubOf(s.playerId)}</td><td className="l">{s.reason}</td><td>{s.matchesTotal ?? "—"}</td></tr>)}</tbody></table>
        )}

        <H>خامسًا: الموقوفون عن {nextLabel}</H>
        {susNow.length === 0 ? none : (
          <table className="roster-table"><thead><tr><th>اللاعب</th><th>النادي</th><th>السبب</th><th>المتبقي</th></tr></thead>
            <tbody>{susNow.sort((a, b) => clubOf(a.s.playerId).localeCompare(clubOf(b.s.playerId), "ar")).map(({ s, player }) => <tr key={s.id}><td className="l">{player}</td><td>{clubOf(s.playerId)}</td><td className="l">{s.reason}</td><td>{(s.matchesTotal ?? 0) - s.matchesServed} مباراة</td></tr>)}</tbody></table>
        )}

        <H>سادسًا: العقوبات والغرامات</H>
        {roundSanctions.length === 0 ? none : (
          <table className="roster-table"><thead><tr><th>رقم القرار</th><th>المعاقَب</th><th>النادي</th><th>العقوبة</th><th>الغرامة</th><th>السبب</th></tr></thead>
            <tbody>{roundSanctions.map(({ s, player }) => <tr key={s.id}><td>{s.number}</td><td>{player ?? (s.targetType === "CLUB" ? "النادي" : "—")}</td><td>{name.get(s.clubId)}</td>
              <td>{SANCTION_TYPE[s.type]}{s.matchesCount ? ` (${s.matchesCount} م)` : ""}{s.points ? ` (${s.points} ن)` : ""}</td><td>{s.fineAmount ? Number(s.fineAmount).toLocaleString("en") + " د.ل" : ""}</td><td className="l" style={{ fontSize: ".75rem" }}>{s.reason.slice(0, 120)}</td></tr>)}</tbody></table>
        )}

        {!ko && <>
          <H>سابعًا: الترتيب بعد {label}</H>
          {table.length === 0 ? none : groups.map((g) => (
            <table key={g} className="roster-table" style={{ marginBottom: 8 }}>
              <thead>{g && <tr><th colSpan={10}>المجموعة {g}</th></tr>}<tr><th>#</th><th>الفريق</th><th>لعب</th><th>فاز</th><th>تعادل</th><th>خسر</th><th>له</th><th>عليه</th><th>الفارق</th><th>النقاط</th></tr></thead>
              <tbody>{table.filter((r) => (r.group ?? "") === g).map((r, i) => (
                <tr key={r.clubId}><td>{i + 1}</td><td className="l">{r.name}{r.deducted ? ` (−${r.deducted})` : ""}</td><td>{r.p}</td><td>{r.w}</td><td>{r.d}</td><td>{r.l}</td><td>{r.gf}</td><td>{r.ga}</td><td>{r.gd}</td><td><strong>{r.pts}</strong></td></tr>
              ))}</tbody>
            </table>
          ))}
        </>}

        <H>{ko ? "سابعًا" : "ثامنًا"}: طواقم التحكيم والمراقبة</H>
        {ms.length === 0 ? none : (
          <table className="roster-table"><thead><tr><th>المباراة</th><th>الطاقم</th></tr></thead>
            <tbody>{ms.map((m) => <tr key={m.id}><td className="l" style={{ width: "35%" }}>{teams(m)}</td><td className="l" style={{ fontSize: ".78rem" }}>{crewOf(m.id).map((x) => `${ASSIGN_ROLE[x.a.role]}: ${x.name}`).join(" — ") || "—"}</td></tr>)}</tbody></table>
        )}

        <H>{ko ? "ثامنًا" : "تاسعًا"}: مباريات {nextLabel}</H>
        {next.length === 0 ? none : (
          <table className="roster-table"><thead><tr><th>المباراة</th><th>الموعد</th><th>الملعب</th><th>الطاقم</th></tr></thead>
            <tbody>{next.map((m) => <tr key={m.id}><td className="l">{teams(m)}</td><td>{fmtDateTime(m.kickoff)}</td><td>{m.venue}</td><td className="l" style={{ fontSize: ".75rem" }}>{crewOf(m.id).map((x) => `${ASSIGN_ROLE[x.a.role]}: ${x.name}`).join(" — ")}</td></tr>)}</tbody></table>
        )}
        <div style={{ marginTop: 28, display: "flex", justifyContent: "space-between", fontSize: ".9rem" }}><span>رئيس لجنة المسابقات</span><span>التوقيع: ....................</span></div>
      </div>
    </div>
  );
}
