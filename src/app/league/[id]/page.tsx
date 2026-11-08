import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { competitions, competitionStages, seasons, matches, clubs, roundDecisions } from "@/db/schema";
import { standings, topScorers } from "@/lib/competition";
import { fmtDate } from "@/lib/util";

export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | undefined>>;
const TABS: [string, string][] = [["table", "الترتيب"], ["fixtures", "المباريات والنتائج"], ["scorers", "الهدافون"], ["decisions", "القرارات"]];

async function load(id: number) {
  if (!Number.isInteger(id)) return null;
  const [c] = await db.select({ c: competitions, season: seasons.name }).from(competitions).innerJoin(seasons, eq(seasons.id, competitions.seasonId)).where(eq(competitions.id, id));
  return c && c.c.isPublic && c.c.status !== "DRAFT" ? c : null;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const c = await load(Number((await params).id));
  return { title: c ? c.c.name : "المسابقة" };
}

const when = (k: Date | null) => (k ? `${k.toLocaleDateString("ar-LY", { weekday: "long", timeZone: "Africa/Tripoli" })} ${fmtDate(k)} — ${k.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Tripoli" })}` : "لم يُحدد");

export default async function LeaguePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const id = Number((await params).id);
  const sp = await searchParams;
  const x = await load(id);
  if (!x) notFound();
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "table";
  return (
    <>
      <div className="lg-crumb"><Link href="/league">المسابقات</Link> / {x.c.name}</div>
      <h1 className="lg-h1">{x.c.name} <small className="muted">الموسم {x.season}</small></h1>
      <nav className="lg-tabs">{TABS.map(([k, l]) => <Link key={k} href={`?tab=${k}`} className={k === tab ? "on" : ""}>{l}</Link>)}</nav>
      {tab === "table" && <Tables id={id} />}
      {tab === "fixtures" && <Fixtures id={id} round={sp.round} />}
      {tab === "scorers" && <Scorers id={id} />}
      {tab === "decisions" && <Decisions id={id} />}
    </>
  );
}

async function Tables({ id }: { id: number }) {
  const stages = await db.select().from(competitionStages).where(eq(competitionStages.competitionId, id)).orderBy(asc(competitionStages.seq));
  const tableStages = stages.filter((s) => s.format !== "KNOCKOUT");
  if (!tableStages.length) return <p className="muted">لا يوجد ترتيب بعد.</p>;
  const blocks = await Promise.all(tableStages.map(async (s) => ({ s, rows: await standings(id, s.id) })));
  return (
    <>{blocks.filter((b) => b.rows.length).map(({ s, rows }) => {
      const groups = [...new Set(rows.map((r) => r.group ?? ""))];
      const q = s.qualifyPerGroup ?? 0;
      return (
        <section key={s.id}>
          {tableStages.length > 1 && <h2 className="lg-h2">{s.name}</h2>}
          <div className={groups.length > 1 ? "lg-two" : ""}>{groups.map((g) => (
            <div key={g} className="lg-box">
              {g && <h3 className="lg-h3">المجموعة {g}</h3>}
              <div className="lg-scroll"><table className="lg-t">
                <thead><tr><th>#</th><th className="tm">الفريق</th><th>لعب</th><th>فاز</th><th>تعادل</th><th>خسر</th><th>له</th><th>عليه</th><th>الفارق</th><th>النقاط</th></tr></thead>
                <tbody>{rows.filter((r) => (r.group ?? "") === g).map((r, i) => (
                  <tr key={r.clubId} className={i < q ? "q" : ""}><td>{i + 1}</td><td className="tm">{r.name}{r.deducted ? <small className="ded"> (−{r.deducted})</small> : null}</td><td>{r.p}</td><td>{r.w}</td><td>{r.d}</td><td>{r.l}</td><td>{r.gf}</td><td>{r.ga}</td><td dir="ltr">{r.gd > 0 ? "+" : ""}{r.gd}</td><td className="pts">{r.pts}</td></tr>))}</tbody>
              </table></div>
            </div>))}</div>
          {rows.some((r) => r.deducted) && <p className="muted" style={{ fontSize: ".8rem" }}>(−ن) نقاط مخصومة بقرار.</p>}
        </section>
      );
    })}</>
  );
}

async function Fixtures({ id, round }: { id: number; round?: string }) {
  const h = alias(clubs, "h"), a = alias(clubs, "a");
  const all = await db.select({ m: matches, home: h.name, away: a.name, st: competitionStages.name }).from(matches)
    .innerJoin(h, eq(h.id, matches.homeClubId)).innerJoin(a, eq(a.id, matches.awayClubId)).leftJoin(competitionStages, eq(competitionStages.id, matches.stageId))
    .where(and(eq(matches.competitionId, id), inArray(matches.status, ["SCHEDULED", "PLAYED", "POSTPONED", "FORFEIT"]))).orderBy(asc(matches.round), asc(matches.kickoff), asc(matches.id));
  const rounds = [...new Set(all.map((x) => x.m.round ?? 0))];
  if (!rounds.length) return <p className="muted">لا توجد مباريات بعد.</p>;
  // افتراضيًا: أقرب جولة فيها مباراة لم تُلعب، وإلا آخر جولة
  const cur = round ? Number(round) : (all.find((x) => x.m.status === "SCHEDULED")?.m.round ?? rounds[rounds.length - 1]);
  const list = all.filter((x) => (x.m.round ?? 0) === cur);
  return (
    <>
      <div className="lg-rounds">{rounds.map((r) => <Link key={r} href={`?tab=fixtures&round=${r}`} className={r === cur ? "on" : ""}>{r ? `الأسبوع ${r}` : "—"}</Link>)}</div>
      <div className="lg-matches">{list.map(({ m, home, away }) => {
        const played = m.status === "PLAYED" || m.status === "FORFEIT";
        return (
          <div key={m.id} className="lg-m">
            <div className="lg-m-meta">{m.groupName ? `المجموعة ${m.groupName} — ` : ""}{when(m.kickoff)}{m.venue ? ` — ${m.venue}` : ""}</div>
            <div className="lg-m-row">
              <span className="t h">{home}</span>
              <span className={`s ${played ? "" : "pending"}`}>{played ? <span dir="ltr">{m.awayScore} - {m.homeScore}</span> : m.status === "POSTPONED" ? "مؤجلة" : "—"}</span>
              <span className="t a">{away}</span>
            </div>
            {m.status === "FORFEIT" && <div className="lg-m-note">نتيجة اعتبارية بقرار</div>}
            {m.homePens != null && <div className="lg-m-note">ركلات الترجيح: <span dir="ltr">{m.awayPens} - {m.homePens}</span></div>}
          </div>);
      })}</div>
    </>
  );
}

async function Scorers({ id }: { id: number }) {
  const rows = await topScorers(id, 30);
  if (!rows.length) return <p className="muted">لم تُسجّل أهداف معتمدة بعد.</p>;
  return (
    <div className="lg-box"><table className="lg-t">
      <thead><tr><th>#</th><th className="tm">اللاعب</th><th className="tm">الفريق</th><th>الأهداف</th></tr></thead>
      <tbody>{rows.map((r, i) => <tr key={r.playerId}><td>{i + 1}</td><td className="tm">{r.name}</td><td className="tm">{r.club}</td><td className="pts">{r.goals}</td></tr>)}</tbody>
    </table></div>
  );
}

async function Decisions({ id }: { id: number }) {
  const rows = await db.select().from(roundDecisions).where(and(eq(roundDecisions.competitionId, id), eq(roundDecisions.status, "ISSUED"))).orderBy(desc(roundDecisions.issueDate), desc(roundDecisions.id));
  if (!rows.length) return <p className="muted">لا توجد قرارات صادرة بعد.</p>;
  return (
    <div className="lg-list">{rows.map((d) => (
      <Link key={d.id} href={`/league/decision/${d.id}`} className="lg-dec">
        <strong>قرار لجنة تنظيم المسابقات رقم ({d.number})</strong>
        <span>{d.content.subject}</span>
        <small className="muted">صدر {fmtDate(d.issueDate)}</small>
      </Link>))}</div>
  );
}
