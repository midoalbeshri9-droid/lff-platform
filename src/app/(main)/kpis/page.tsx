import Link from "next/link";
import { and, desc, eq, gte, inArray, isNotNull, lte, ne, notInArray, sql, lt } from "drizzle-orm";
import { db } from "@/db";
import { seasons, registrations, players, staff, competitions, matches, matchEvents, sanctions, payments, charges, assignments, decisions, correspondence, matchReportForms, roundDecisions, evaluations } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { money, today } from "@/lib/util";
import { PageHead } from "@/components/ui";

type Season = typeof seasons.$inferSelect;
const n = (v: unknown) => Number(v ?? 0);

async function seasonKpis(s: Season) {
  const regs = await db.select({ type: registrations.type, foreign: players.isForeign, club: registrations.clubId })
    .from(registrations).innerJoin(players, eq(players.id, registrations.playerId))
    .where(and(eq(registrations.seasonId, s.id), inArray(registrations.status, ["APPROVED", "TRANSFERRED", "EXPIRED"])));
  const [st] = await db.select({ c: sql<number>`count(*)::int` }).from(staff).where(and(eq(staff.seasonId, s.id), eq(staff.status, "APPROVED")));
  const comps = await db.select({ id: competitions.id }).from(competitions).where(eq(competitions.seasonId, s.id));
  const cids = comps.map((c) => c.id);
  const ms = cids.length ? await db.select({ id: matches.id, h: matches.homeScore, a: matches.awayScore, status: matches.status }).from(matches).where(inArray(matches.competitionId, cids)) : [];
  const played = ms.filter((m) => ["PLAYED", "FORFEIT"].includes(m.status));
  const goals = played.reduce((t, m) => t + n(m.h) + n(m.a), 0);
  const ids = played.map((m) => m.id);
  const ev = ids.length ? await db.select({ type: matchEvents.type, c: sql<number>`count(*)::int` }).from(matchEvents).where(inArray(matchEvents.matchId, ids)).groupBy(matchEvents.type) : [];
  const evc = (t: string) => n(ev.find((x) => x.type === t)?.c);
  const [sa] = await db.select({ c: sql<number>`count(*)::int`, fines: sql<string>`coalesce(sum(${sanctions.fineAmount}),0)` }).from(sanctions)
    .where(and(gte(sanctions.decisionDate, s.startDate), lte(sanctions.decisionDate, s.endDate), ne(sanctions.status, "REVOKED")));
  const pay = await db.select({ dir: payments.direction, t: sql<string>`coalesce(sum(${payments.amount}),0)` }).from(payments)
    .where(and(gte(payments.date, s.startDate), lte(payments.date, s.endDate), eq(payments.isVoided, false))).groupBy(payments.direction);
  const [ch] = await db.select({ t: sql<string>`coalesce(sum(${charges.amount}),0)`, p: sql<string>`coalesce(sum(${charges.paidAmount}),0)` }).from(charges)
    .where(and(eq(charges.direction, "IN"), notInArray(charges.status, ["CANCELLED", "WAIVED"]), sql`${charges.createdAt}::date between ${s.startDate} and ${s.endDate}`));
  const [refs] = ids.length || ms.length ? await db.select({ c: sql<number>`count(distinct ${assignments.officialId})::int` }).from(assignments)
    .where(and(inArray(assignments.matchId, ms.map((m) => m.id).concat([0])), eq(assignments.status, "APPROVED"))) : [{ c: 0 }];
  return {
    clubs: new Set(regs.map((r) => r.club)).size, players: regs.length, newRegs: regs.filter((r) => r.type === "NEW").length,
    transfers: regs.filter((r) => r.type === "TRANSFER").length, loans: regs.filter((r) => r.type === "LOAN").length, foreign: regs.filter((r) => r.foreign).length,
    staff: n(st?.c), competitions: cids.length, matches: ms.length, played: played.length, goals, avgGoals: played.length ? goals / played.length : 0,
    yellow: evc("YELLOW"), red: evc("RED") + evc("SECOND_YELLOW"), sanctions: n(sa?.c), fines: n(sa?.fines),
    revenue: n(pay.find((p) => p.dir === "IN")?.t), payouts: n(pay.find((p) => p.dir === "OUT")?.t), billed: n(ch?.t), collected: n(ch?.p), referees: n(refs?.c),
  };
}
type K = Awaited<ReturnType<typeof seasonKpis>>;

/** أداء اللجان خلال آخر 90 يومًا — مؤشرات سرعة الإنجاز والالتزام */
async function committeePerf() {
  const since = new Date(Date.now() - 90 * 864e5);
  const [reg] = await db.select({
    avg: sql<number | null>`avg(extract(epoch from (${registrations.decidedAt} - ${registrations.submittedAt})) / 86400)`,
    n: sql<number>`count(*)::int`,
    ret: sql<number>`count(*) filter (where ${registrations.status} = 'NEEDS_CORRECTION')::int`,
  }).from(registrations).where(and(isNotNull(registrations.submittedAt), gte(registrations.submittedAt, since)));
  const [regDone] = await db.select({ avg: sql<number | null>`avg(extract(epoch from (${registrations.decidedAt} - ${registrations.submittedAt})) / 86400)` })
    .from(registrations).where(and(isNotNull(registrations.decidedAt), isNotNull(registrations.submittedAt), gte(registrations.decidedAt, since)));
  const [rep] = await db.select({ avg: sql<number | null>`avg(extract(epoch from (${matches.approvedAt} - ${matches.kickoff})) / 86400)`, n: sql<number>`count(*)::int` })
    .from(matches).where(and(eq(matches.reportStatus, "APPROVED"), isNotNull(matches.kickoff), gte(matches.approvedAt, since)));
  const [late] = await db.select({ c: sql<number>`count(*)::int` }).from(matches)
    .where(and(inArray(matches.status, ["SCHEDULED", "PLAYED"]), ne(matches.reportStatus, "APPROVED"), lt(matches.kickoff, new Date(Date.now() - 3 * 864e5)), gte(matches.kickoff, since)));
  const [obsNeed] = await db.select({ c: sql<number>`count(*)::int` }).from(assignments).innerJoin(matches, eq(matches.id, assignments.matchId))
    .where(and(eq(assignments.role, "COMMISSIONER"), eq(assignments.status, "APPROVED"), lt(matches.kickoff, new Date()), gte(matches.kickoff, since)));
  const [obsGot] = await db.select({ c: sql<number>`count(*)::int` }).from(matchReportForms).innerJoin(matches, eq(matches.id, matchReportForms.matchId))
    .where(and(eq(matchReportForms.kind, "COMMISSIONER"), eq(matchReportForms.isSubmitted, true), gte(matches.kickoff, since)));
  const [decs] = await db.select({ c: sql<number>`count(*)::int` }).from(roundDecisions).where(and(eq(roundDecisions.status, "ISSUED"), gte(roundDecisions.issuedAt, since)));
  const week = new Date(Date.now() + 7 * 864e5);
  const up = await db.select({ id: matches.id, n: sql<number>`(select count(*)::int from ${assignments} a where a.match_id = ${matches.id} and a.status = 'APPROVED' and a.role in ('REFEREE','AR1','AR2'))` })
    .from(matches).where(and(eq(matches.status, "SCHEDULED"), gte(matches.kickoff, new Date()), lte(matches.kickoff, week)));
  const [ev] = await db.select({ avg: sql<number | null>`avg(${evaluations.score})` }).from(evaluations).innerJoin(matches, eq(matches.id, evaluations.matchId)).where(and(eq(evaluations.isSubmitted, true), gte(matches.kickoff, since)));
  const [fin] = await db.select({ t: sql<string>`coalesce(sum(${charges.amount}),0)`, p: sql<string>`coalesce(sum(${charges.paidAmount}),0)` }).from(charges)
    .where(and(eq(charges.direction, "IN"), notInArray(charges.status, ["CANCELLED", "WAIVED"]), gte(charges.createdAt, since)));
  const [owedRefs] = await db.select({ t: sql<string>`coalesce(sum(${charges.amount} - ${charges.paidAmount}),0)` }).from(charges).where(and(eq(charges.direction, "OUT"), inArray(charges.status, ["OPEN", "PARTIAL"])));
  const days = (v: number | null) => (v == null ? "—" : v < 1 ? `${Math.round(v * 24)} ساعة` : `${v.toFixed(1)} يوم`);
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
  return [
    { c: "لجنة القيد", items: [
      ["متوسط زمن البت في طلب القيد", days(regDone.avg == null ? null : n(regDone.avg))],
      ["طلبات أُرسلت خلال الفترة", String(reg.n)],
      ["نسبة الطلبات المعادة للاستكمال", pct(reg.ret, reg.n)],
    ] },
    { c: "لجنة المسابقات", items: [
      ["متوسط زمن اعتماد نتيجة المباراة", days(rep.avg == null ? null : n(rep.avg))],
      ["مباريات تجاوزت 3 أيام دون اعتماد", String(late.c), late.c ? "bad" : ""],
      ["تقارير المراقبين المستلمة", `${obsGot.c} من ${obsNeed.c} — ${pct(obsGot.c, obsNeed.c)}`, obsGot.c < obsNeed.c ? "warn" : ""],
      ["قرارات الجولات الصادرة", String(decs.c)],
    ] },
    { c: "لجنة الحكام", items: [
      ["مباريات الأسبوع القادم بلا طاقم كامل", `${up.filter((x) => x.n < 3).length} من ${up.length}`, up.some((x) => x.n < 3) ? "warn" : ""],
      ["متوسط تقييم الحكام", ev.avg == null ? "—" : n(ev.avg).toFixed(2)],
    ] },
    { c: "اللجنة المالية", items: [
      ["نسبة تحصيل المستحقات", pct(n(fin.p), n(fin.t))],
      ["مستحقات حكام ومراقبين لم تُصرف", money(n(owedRefs.t)), n(owedRefs.t) ? "warn" : ""],
    ] },
  ] as { c: string; items: [string, string, string?][] }[];
}

const ROWS: { k: keyof K; label: string; group: string; fmt?: (v: number) => string; bar?: boolean }[] = [
  { group: "القيد", k: "clubs", label: "الأندية المسجلة" },
  { group: "القيد", k: "players", label: "اللاعبون المقيدون", bar: true },
  { group: "القيد", k: "newRegs", label: "قيد جديد" },
  { group: "القيد", k: "transfers", label: "انتقالات نهائية" },
  { group: "القيد", k: "loans", label: "إعارات" },
  { group: "القيد", k: "foreign", label: "لاعبون أجانب" },
  { group: "القيد", k: "staff", label: "إداريون وأجهزة فنية" },
  { group: "المسابقات", k: "competitions", label: "المسابقات" },
  { group: "المسابقات", k: "matches", label: "المباريات المجدولة" },
  { group: "المسابقات", k: "played", label: "المباريات الملعوبة", bar: true },
  { group: "المسابقات", k: "goals", label: "الأهداف" },
  { group: "المسابقات", k: "avgGoals", label: "معدل الأهداف للمباراة", fmt: (v) => v.toFixed(2) },
  { group: "الانضباط", k: "yellow", label: "الإنذارات" },
  { group: "الانضباط", k: "red", label: "حالات الطرد" },
  { group: "الانضباط", k: "sanctions", label: "قرارات العقوبات" },
  { group: "الانضباط", k: "fines", label: "قيمة الغرامات (د.ل)", fmt: money },
  { group: "المالية", k: "revenue", label: "الإيرادات المحصلة (د.ل)", fmt: money, bar: true },
  { group: "المالية", k: "payouts", label: "المصروفات (د.ل)", fmt: money },
  { group: "المالية", k: "billed", label: "المستحقات المطالب بها (د.ل)", fmt: money },
  { group: "المالية", k: "collected", label: "المحصل منها (د.ل)", fmt: money },
  { group: "التحكيم", k: "referees", label: "حكام ومراقبون شاركوا" },
];

export default async function Kpis() {
  await requireUser("kpi.view");
  const ss = (await db.select().from(seasons).orderBy(desc(seasons.startDate))).slice(0, 4);
  const [data, perf] = await Promise.all([Promise.all(ss.map(seasonKpis)), committeePerf()]);
  const t = today();
  const [lateDec] = await db.select({ c: sql<number>`count(*)::int` }).from(decisions).where(and(lt(decisions.dueDate, t), notInArray(decisions.status, ["DONE", "CANCELLED"])));
  const [openDec] = await db.select({ c: sql<number>`count(*)::int` }).from(decisions).where(inArray(decisions.status, ["PENDING", "IN_PROGRESS"]));
  const [lateMail] = await db.select({ c: sql<number>`count(*)::int` }).from(correspondence).where(and(eq(correspondence.status, "OPEN"), isNotNull(correspondence.dueDate), lt(correspondence.dueDate, t)));
  const [pendRegs] = await db.select({ c: sql<number>`count(*)::int` }).from(registrations).where(eq(registrations.status, "SUBMITTED"));
  const [pendRep] = await db.select({ c: sql<number>`count(*)::int` }).from(matches).where(eq(matches.reportStatus, "SUBMITTED"));
  const [owed] = await db.select({ t: sql<string>`coalesce(sum(${charges.amount} - ${charges.paidAmount}),0)` }).from(charges).where(and(eq(charges.direction, "IN"), inArray(charges.status, ["OPEN", "PARTIAL"])));
  const cur = data[0], prev = data[1];
  const delta = (k: keyof K) => {
    if (!cur || !prev || !prev[k]) return null;
    const d = ((cur[k] - prev[k]) / prev[k]) * 100;
    return <span className={d >= 0 ? "ok-text" : "danger-text"} style={{ fontSize: ".75rem" }}>{d >= 0 ? "▲" : "▼"} {Math.abs(d).toFixed(0)}%</span>;
  };
  const tiles: [string, string | number, string, string?][] = [
    ["طلبات قيد بانتظار المراجعة", pendRegs.c, "/registration/requests"],
    ["تقارير مباريات بانتظار الاعتماد", pendRep.c, "/matches?report=SUBMITTED"],
    ["قرارات قيد التنفيذ", openDec.c, "/secretariat/decisions?open=1"],
    ["قرارات متأخرة", lateDec.c, "/secretariat/decisions?late=1", lateDec.c ? "danger" : undefined],
    ["مراسلات تجاوزت موعد الرد", lateMail.c, "/secretariat/mail?status=OPEN", lateMail.c ? "danger" : undefined],
    ["مستحقات غير محصلة على الأندية", money(n(owed.t)), "/finance/clubs"],
  ];
  let lastGroup = "";
  return (
    <>
      <PageHead title="لوحة المؤشرات" sub="مؤشرات الاتحاد الرئيسية ومقارنتها بين المواسم" />
      <div className="kpi-tiles">
        {tiles.map(([l, v, href, cls]) => <Link key={l} href={href} className={`card kpi-tile ${cls ?? ""}`}><div className="kpi-v">{v}</div><div className="muted">{l}</div></Link>)}
      </div>
      <h2 className="mt">أداء اللجان <small className="muted" style={{ fontSize: ".8rem", fontWeight: 400 }}>آخر 90 يومًا</small></h2>
      <div className="perf-grid">{perf.map((g) => (
        <div key={g.c} className="card"><h3>{g.c}</h3>
          {g.items.map(([l, v, cls]) => <div key={l} className="perf-row"><span>{l}</span><strong className={cls === "bad" ? "danger-text" : cls === "warn" ? "warn-text" : ""}>{v}</strong></div>)}
        </div>))}</div>
      <div className="card table-wrap">
        <table className="t kpi-table no-num">
          <thead><tr><th>المؤشر</th>{ss.map((s, i) => <th key={s.id} className="num">{s.name}{i === 0 && " (الحالي)"}</th>)}<th>مقارنة بالموسم السابق</th></tr></thead>
          <tbody>{ROWS.map((r) => {
            const max = Math.max(...data.map((d) => d[r.k]), 1);
            const head = r.group !== lastGroup ? (lastGroup = r.group) : null;
            return [
              head && <tr key={`g-${r.group}`} className="kpi-group"><td colSpan={ss.length + 2}>{r.group}</td></tr>,
              <tr key={r.k}>
                <td>{r.label}</td>
                {data.map((d, i) => (
                  <td key={i} className="num">
                    {r.fmt ? r.fmt(d[r.k]) : d[r.k].toLocaleString("en")}
                    {r.bar && <div className="kpi-bar"><span style={{ width: `${(d[r.k] / max) * 100}%` }} /></div>}
                  </td>
                ))}
                <td>{delta(r.k)}</td>
              </tr>,
            ];
          })}</tbody>
        </table>
      </div>
    </>
  );
}
