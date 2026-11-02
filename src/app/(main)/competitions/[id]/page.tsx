import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, desc, asc, notInArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { competitions, competitionTeams, clubs, matches, seasons, ageCategories, suspensions, players, matchEvents, registrations, competitionSquads } from "@/db/schema";
import { sql } from "drizzle-orm";
import { SquadListForm } from "@/components/SquadList";
import { POSITION } from "@/lib/labels";
import { requireUser } from "@/lib/auth";
import { standings, topScorers } from "@/lib/competition";
import { COMP_TYPE, COMP_STATUS, MATCH_STATUS, REPORT_STATUS } from "@/lib/labels";
import { fmtDateTime, toLocalInput } from "@/lib/util";
import { PageHead, Flash, Badge, Empty, Field, Options, type SP } from "@/components/ui";
import { Submit, CheckAll } from "@/components/Client";
import {
  saveCompetition, setCompetitionStatus, addTeams, removeTeam, makeFixtures, clearFixtures, saveMatch, bulkSchedule,
} from "../actions";

export default async function Competition({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const u = await requireUser("comp.view");
  const id = Number((await params).id);
  const sp = await searchParams;
  const tab = sp.tab ?? "fixtures";
  const [c] = await db.select().from(competitions).where(eq(competitions.id, id));
  if (!c) notFound();
  const [season] = await db.select().from(seasons).where(eq(seasons.id, c.seasonId));
  const teams = await db.select({ t: competitionTeams, club: clubs }).from(competitionTeams).innerJoin(clubs, eq(clubs.id, competitionTeams.clubId))
    .where(eq(competitionTeams.competitionId, id)).orderBy(competitionTeams.groupName, clubs.name);
  const manage = u.can("comp.manage");
  const tabs: [string, string][] = [["fixtures", "الجدول والمباريات"], ["table", "الترتيب"], ["scorers", "الهدافون"], ["discipline", "الإيقافات"], ["fairplay", "اللعب النظيف"],
    ...(c.squadListMax != null ? [["squads", "قوائم الموسم"] as [string, string]] : []), ["teams", `الفرق (${teams.length})`], ["settings", "الإعدادات"]];

  return (
    <>
      <PageHead title={c.name} sub={<>{season.name} — {COMP_TYPE[c.type]} — <Badge v={COMP_STATUS[c.status]} /></>} crumbs={[["المسابقات", "/competitions"], [c.name]]}
        actions={manage && (
          <form action={setCompetitionStatus} className="row">
            <input type="hidden" name="id" value={id} />
            <select name="status" defaultValue={c.status} style={{ width: "auto" }}>{Object.entries(COMP_STATUS).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</select>
            <Submit className="btn btn-light btn-sm">تحديث الحالة</Submit>
          </form>
        )} />
      <Flash sp={sp} />
      <div className="tabs">{tabs.map(([k, l]) => <Link key={k} href={`?tab=${k}`} className={`tab ${tab === k ? "active" : ""}`}>{l}</Link>)}</div>
      {tab === "fixtures" && <Fixtures id={id} manage={manage} teams={teams} />}
      {tab === "table" && <Table id={id} />}
      {tab === "scorers" && <Scorers id={id} />}
      {tab === "discipline" && <Discipline id={id} />}
      {tab === "fairplay" && <FairPlay id={id} />}
      {tab === "squads" && c.squadListMax != null && <Squads c={c} teams={teams} clubId={sp.club ? Number(sp.club) : teams[0]?.club.id} canEdit={u.can("comp.lineups")} />}
      {tab === "teams" && <Teams id={id} manage={manage} teams={teams} groups={c.type === "GROUPS"} />}
      {tab === "settings" && <Settings c={c} manage={manage} />}
    </>
  );
}

async function Fixtures({ id, manage, teams }: { id: number; manage: boolean; teams: { club: { id: number; name: string } }[] }) {
  const h = alias(clubs, "h"), a = alias(clubs, "a");
  const ms = await db.select({ m: matches, home: h.name, away: a.name }).from(matches).innerJoin(h, eq(h.id, matches.homeClubId)).innerJoin(a, eq(a.id, matches.awayClubId))
    .where(eq(matches.competitionId, id)).orderBy(asc(matches.round), asc(matches.kickoff), asc(matches.id));
  const rounds = [...new Set(ms.map((x) => x.m.round))];
  return (
    <>
      {manage && (
        <div className="card row">
          {ms.length === 0 ? (
            <form action={makeFixtures}><input type="hidden" name="id" value={id} /><Submit confirm="إنشاء جدول المباريات تلقائيًا لكل الفرق؟">⚙ إنشاء الجدول تلقائيًا</Submit></form>
          ) : (
            <form action={clearFixtures}><input type="hidden" name="id" value={id} /><Submit className="btn btn-ghost" confirm="حذف كل المباريات؟">حذف الجدول</Submit></form>
          )}
          <details className="box" style={{ flex: 1, margin: 0 }}>
            <summary>+ مباراة يدوية</summary>
            <form action={saveMatch} className="form f3 mt">
              <input type="hidden" name="competitionId" value={id} />
              <Field label="المضيف"><select name="homeClubId">{teams.map((t) => <option key={t.club.id} value={t.club.id}>{t.club.name}</option>)}</select></Field>
              <Field label="الضيف"><select name="awayClubId">{teams.map((t) => <option key={t.club.id} value={t.club.id}>{t.club.name}</option>)}</select></Field>
              <Field label="الجولة"><input type="number" name="round" defaultValue={1} /></Field>
              <Field label="الموعد"><input type="datetime-local" name="kickoff" /></Field>
              <Field label="الملعب"><input type="text" name="venue" /></Field>
              <div className="full"><Submit>إضافة</Submit></div>
            </form>
          </details>
          <Link className="btn btn-light" href={`/print/fixtures/${id}`} target="_blank">🖨 طباعة الجدول</Link>
        </div>
      )}
      {ms.length === 0 ? <div className="card"><Empty>لم يُنشأ الجدول بعد</Empty></div> : (
        <form action={bulkSchedule}>
          <input type="hidden" name="competitionId" value={id} />
          {rounds.map((r) => (
            <div key={r} className="card table-wrap">
              <h3>الجولة {r}</h3>
              <table className="t"><tbody>{ms.filter((x) => x.m.round === r).map(({ m, home, away }) => (
                <tr key={m.id}>
                  <td style={{ width: "30%" }}><strong>{home}</strong> × <strong>{away}</strong>{m.groupName && <span className="b b-gray" style={{ marginInlineStart: 6 }}>{m.groupName}</span>}</td>
                  <td>{manage && m.reportStatus === "NONE" ? <><input type="hidden" name="mid" value={m.id} /><input type="datetime-local" name={`k_${m.id}`} defaultValue={toLocalInput(m.kickoff)} /></> : fmtDateTime(m.kickoff)}</td>
                  <td>{manage && m.reportStatus === "NONE" ? <input type="text" name={`v_${m.id}`} defaultValue={m.venue ?? ""} placeholder="الملعب" /> : m.venue}</td>
                  <td className="num"><strong>{m.homeScore != null ? `${m.homeScore} - ${m.awayScore}` : "—"}</strong></td>
                  <td><Badge v={MATCH_STATUS[m.status]} /> {m.reportStatus !== "NONE" && <Badge v={REPORT_STATUS[m.reportStatus]} />}</td>
                  <td><Link className="btn btn-sm btn-light" href={`/matches/${m.id}`}>التفاصيل</Link></td>
                </tr>
              ))}</tbody></table>
            </div>
          ))}
          {manage && <div className="card"><Submit>💾 حفظ المواعيد والملاعب</Submit></div>}
        </form>
      )}
    </>
  );
}

async function Table({ id }: { id: number }) {
  const rows = await standings(id);
  const groups = [...new Set(rows.map((r) => r.group ?? ""))];
  return (
    <>
      <div className="row no-print" style={{ marginBottom: ".6rem" }}><Link className="btn btn-light btn-sm" href={`/print/standings/${id}`} target="_blank">🖨 طباعة الترتيب</Link></div>
      {groups.map((g) => (
        <div key={g} className="card table-wrap">
          {g && <h3>المجموعة {g}</h3>}
          <table className="t"><thead><tr><th>#</th><th>الفريق</th><th className="num">لعب</th><th className="num">فاز</th><th className="num">تعادل</th><th className="num">خسر</th><th className="num">له</th><th className="num">عليه</th><th className="num">الفارق</th><th className="num">النقاط</th><th className="num">مخصوم</th></tr></thead>
            <tbody>{rows.filter((r) => (r.group ?? "") === g).map((r, i) => (
              <tr key={r.clubId}><td>{i + 1}</td><td><strong>{r.name}</strong></td><td className="num">{r.p}</td><td className="num">{r.w}</td><td className="num">{r.d}</td><td className="num">{r.l}</td>
                <td className="num">{r.gf}</td><td className="num">{r.ga}</td><td className="num">{r.gd > 0 ? "+" : ""}{r.gd}</td><td className="num"><strong>{r.pts}</strong></td><td className="num">{r.deducted ? <span className="danger-text">−{r.deducted}</span> : ""}</td></tr>
            ))}</tbody></table>
        </div>
      ))}
    </>
  );
}

async function Scorers({ id }: { id: number }) {
  const rows = await topScorers(id, 30);
  return (
    <div className="card table-wrap">
      {rows.length === 0 ? <Empty>لا أهداف مسجلة بعد</Empty> : (
        <table className="t"><thead><tr><th>#</th><th>اللاعب</th><th>النادي</th><th className="num">الأهداف</th></tr></thead>
          <tbody>{rows.map((r, i) => <tr key={r.playerId}><td>{i + 1}</td><td><Link href={`/registration/players/${r.playerId}`}>{r.name}</Link></td><td>{r.club}</td><td className="num"><strong>{r.goals}</strong></td></tr>)}</tbody></table>
      )}
    </div>
  );
}

async function Discipline({ id }: { id: number }) {
  const rows = await db.select({ s: suspensions, name: players.fullName }).from(suspensions).innerJoin(players, eq(players.id, suspensions.playerId))
    .where(eq(suspensions.competitionId, id)).orderBy(desc(suspensions.id));
  return (
    <div className="card table-wrap">
      {rows.length === 0 ? <Empty>لا إيقافات في هذه المسابقة</Empty> : (
        <table className="t"><thead><tr><th>اللاعب</th><th>السبب</th><th>المباريات</th><th>الحالة</th><th>المباراة المصدر</th></tr></thead>
          <tbody>{rows.map(({ s, name }) => {
            const active = !s.isLifted && (s.matchesTotal ?? 0) > s.matchesServed;
            return <tr key={s.id} className={active ? "danger" : ""}><td><Link href={`/registration/players/${s.playerId}`}>{name}</Link></td><td>{s.reason}{s.isAutomatic && <span className="b b-gray">تلقائي</span>}</td>
              <td>{s.matchesServed} / {s.matchesTotal}</td><td>{s.isLifted ? "مرفوع" : active ? <span className="b b-red">ساري</span> : <span className="b b-green">قُضي</span>}</td>
              <td>{s.sourceMatchId && <Link href={`/matches/${s.sourceMatchId}`}>#{s.sourceMatchId}</Link>}</td></tr>;
          })}</tbody></table>
      )}
    </div>
  );
}

async function Teams({ id, manage, teams, groups }: { id: number; manage: boolean; teams: { t: { groupName: string | null }; club: { id: number; name: string; city: string | null } }[]; groups: boolean }) {
  const ids = teams.map((t) => t.club.id);
  const others = await db.select({ id: clubs.id, name: clubs.name }).from(clubs).where(and(eq(clubs.isActive, true), ids.length ? notInArray(clubs.id, ids) : undefined)).orderBy(clubs.name);
  return (
    <div className="grid g2">
      <div className="card table-wrap">
        <h3>الفرق المشاركة</h3>
        <table className="t"><tbody>{teams.map(({ t, club }) => (
          <tr key={club.id}><td><strong>{club.name}</strong></td><td>{club.city}</td><td>{t.groupName && `المجموعة ${t.groupName}`}</td>
            <td>{manage && <form action={removeTeam}><input type="hidden" name="id" value={id} /><input type="hidden" name="clubId" value={club.id} /><Submit className="btn btn-sm btn-ghost" confirm="حذف الفريق؟">حذف</Submit></form>}</td></tr>
        ))}</tbody></table>
      </div>
      {manage && (
        <form action={addTeams} className="card">
          <h3>إضافة فرق</h3>
          <input type="hidden" name="id" value={id} />
          {groups && <Field label="المجموعة"><input type="text" name="groupName" placeholder="أ" /></Field>}
          <CheckAll name="club" />
          <div className="chk-grid mt">{others.map((c) => <label key={c.id} className="check"><input type="checkbox" name="club" value={c.id} /> {c.name}</label>)}</div>
          <div className="mt"><Submit>إضافة المحدد</Submit></div>
        </form>
      )}
    </div>
  );
}

async function Settings({ c, manage }: { c: typeof competitions.$inferSelect; manage: boolean }) {
  const ss = await db.select().from(seasons).orderBy(desc(seasons.startDate));
  const cats = await db.select().from(ageCategories).orderBy(ageCategories.sortOrder);
  return (
    <form action={saveCompetition} className="card form f3">
      <input type="hidden" name="id" value={c.id} />
      <Field label="الاسم"><input type="text" name="name" defaultValue={c.name} required /></Field>
      <Field label="الموسم"><select name="seasonId" defaultValue={c.seasonId}>{ss.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      <Field label="النوع"><select name="type" defaultValue={c.type}><Options map={COMP_TYPE} /></select></Field>
      <Field label="الفئة العمرية"><select name="categoryId" defaultValue={c.categoryId ?? ""}><option value="">الفريق الأول (مفتوحة)</option>{cats.filter((x) => x.maxAge != null).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
      <Field label="الأدوار"><input type="number" name="legs" defaultValue={c.legs} /></Field>
      <Field label="تاريخ البداية"><input type="date" name="startDate" defaultValue={c.startDate ?? ""} /></Field>
      <Field label="نقاط الفوز"><input type="number" name="pointsWin" defaultValue={c.pointsWin} /></Field>
      <Field label="نقاط التعادل"><input type="number" name="pointsDraw" defaultValue={c.pointsDraw} /></Field>
      <Field label="الأجانب في قائمة المباراة"><input type="number" name="maxForeign" defaultValue={c.maxForeign ?? ""} placeholder="بلا حد" /></Field>
      <Field label="الأجانب داخل الملعب معًا"><input type="number" name="maxForeignOnPitch" defaultValue={c.maxForeignOnPitch ?? ""} placeholder="بلا حد" /></Field>
      <Field label="قائمة الموسم (عدد اللاعبين)" hint="فارغ = غير مطلوبة"><input type="number" name="squadListMax" defaultValue={c.squadListMax ?? ""} /></Field>
      <Field label="مستويات الإنذارات" hint="مثال 3:1,5:2,7:3 (عند 3 إيقاف مباراة...) — فارغ = الحد الثابت"><input type="text" name="yellowRules" dir="ltr" defaultValue={c.yellowRules ?? ""} /></Field>
      <Field label="رسوم الاشتراك (د.ل)"><input type="number" step="0.01" name="entryFee" defaultValue={c.entryFee ?? ""} /></Field>
      <Field label="عدد لاعبي القائمة"><input type="number" name="squadMax" defaultValue={c.squadMax} /></Field>
      <Field label="الأساسيون"><input type="number" name="startersCount" defaultValue={c.startersCount} /></Field>
      <Field label="تراكم الإنذارات"><input type="number" name="yellowThreshold" defaultValue={c.yellowThreshold} /></Field>
      <Field label="إيقاف الطرد المباشر (مباريات)"><input type="number" name="redBanMatches" defaultValue={c.redBanMatches} /></Field>
      <Field label="ملاحظات" full><textarea name="notes" defaultValue={c.notes ?? ""} /></Field>
      {manage && <div className="full"><Submit>حفظ الإعدادات</Submit></div>}
    </form>
  );
}

async function FairPlay({ id }: { id: number }) {
  const rows = await db.select({
    club: clubs.name,
    y: sql<number>`sum(case when ${matchEvents.type} = 'YELLOW' then 1 else 0 end)::int`,
    r2: sql<number>`sum(case when ${matchEvents.type} = 'SECOND_YELLOW' then 1 else 0 end)::int`,
    r: sql<number>`sum(case when ${matchEvents.type} = 'RED' then 1 else 0 end)::int`,
  }).from(matchEvents).innerJoin(matches, eq(matches.id, matchEvents.matchId)).innerJoin(clubs, eq(clubs.id, matchEvents.clubId))
    .where(and(eq(matches.competitionId, id), eq(matches.reportStatus, "APPROVED"))).groupBy(clubs.name);
  const scored = rows.map((x) => ({ ...x, pts: x.y + x.r2 * 3 + x.r * 4 })).sort((a, b) => a.pts - b.pts);
  return (
    <div className="card table-wrap">
      <p className="muted">ترتيب اللعب النظيف: إنذار = 1، إنذار ثانٍ = 3، طرد مباشر = 4 (الأقل نقاطًا هو الأنظف).</p>
      {scored.length === 0 ? <Empty>لا بيانات بعد</Empty> : (
        <table className="t"><thead><tr><th>#</th><th>النادي</th><th className="num">🟨</th><th className="num">🟨🟥</th><th className="num">🟥</th><th className="num">النقاط</th></tr></thead>
          <tbody>{scored.map((x, i) => <tr key={x.club}><td>{i + 1}</td><td><strong>{x.club}</strong></td><td className="num">{x.y}</td><td className="num">{x.r2}</td><td className="num">{x.r}</td><td className="num"><strong>{x.pts}</strong></td></tr>)}</tbody></table>
      )}
    </div>
  );
}

async function Squads({ c, teams, clubId, canEdit }: { c: typeof competitions.$inferSelect; teams: { club: { id: number; name: string } }[]; clubId?: number; canEdit: boolean }) {
  if (!clubId) return <div className="card"><Empty>لا فرق</Empty></div>;
  const regs = await db.select({ p: players, num: registrations.number, cat: ageCategories.name }).from(registrations).innerJoin(players, eq(players.id, registrations.playerId))
    .leftJoin(ageCategories, eq(ageCategories.id, registrations.categoryId))
    .where(and(eq(registrations.clubId, clubId), eq(registrations.seasonId, c.seasonId), eq(registrations.status, "APPROVED"))).orderBy(players.fullName);
  const chosen = new Set((await db.select().from(competitionSquads).where(and(eq(competitionSquads.competitionId, c.id), eq(competitionSquads.clubId, clubId)))).map((x) => x.playerId));
  return (
    <>
      <div className="tabs">{teams.map((t) => <Link key={t.club.id} href={`?tab=squads&club=${t.club.id}`} className={`tab ${t.club.id === clubId ? "active" : ""}`}>{t.club.name}</Link>)}</div>
      <SquadListForm competitionId={c.id} clubId={clubId} max={c.squadListMax!} maxForeign={c.maxForeign} readOnly={!canEdit}
        rows={regs.map((r) => ({ id: r.p.id, name: r.p.fullName, num: r.num, cat: r.cat, pos: POSITION[r.p.position], foreign: r.p.isForeign, checked: chosen.has(r.p.id) }))} />
    </>
  );
}
