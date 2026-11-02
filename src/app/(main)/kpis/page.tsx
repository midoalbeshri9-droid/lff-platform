import Link from "next/link";
import { and, desc, eq, gte, inArray, isNotNull, lte, ne, notInArray, sql, lt } from "drizzle-orm";
import { db } from "@/db";
import { seasons, registrations, players, staff, competitions, matches, matchEvents, sanctions, payments, charges, assignments, decisions, correspondence } from "@/db/schema";
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
  const data = await Promise.all(ss.map(seasonKpis));
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
      <div className="card table-wrap">
        <table className="t kpi-table">
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
