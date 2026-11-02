import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, desc, asc, notInArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { competitions, competitionTeams, clubs, matches, seasons, ageCategories, suspensions, players, matchEvents, registrations, competitionSquads, stageTeams } from "@/db/schema";
import { sql } from "drizzle-orm";
import { SquadListForm } from "@/components/SquadList";
import { POSITION } from "@/lib/labels";
import { requireUser } from "@/lib/auth";
import { standings, topScorers } from "@/lib/competition";
import { allStadiums } from "@/lib/stadiums";
import { ensureStages, knockoutRounds, STAGE_FORMAT, STAGE_STATUS, type Stage } from "@/lib/stages";
import { GROUP_LETTERS } from "@/lib/competitionPure";
import { COMP_TYPE, COMP_STATUS, MATCH_STATUS, REPORT_STATUS, TIEBREAK } from "@/lib/labels";
import { fmtDateTime, toLocalInput } from "@/lib/util";
import { PageHead, Flash, Badge, Empty, Field, Options, type SP } from "@/components/ui";
import { Submit, CheckAll } from "@/components/Client";
import {
  saveCompetition, setCompetitionStatus, addTeams, removeTeam, makeFixtures, clearFixtures, saveMatch, bulkSchedule,
  addStage, saveStage, deleteStage, stageAddTeams, stageRemoveTeam, stageDraw, stageSaveGroups, stageQualify, stageNextRound,
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
  const stages = await ensureStages(id);
  const current = stages.find((x) => x.status === "ACTIVE") ?? stages.find((x) => x.status !== "DONE") ?? stages[stages.length - 1];
  const stage = stages.find((x) => x.id === Number(sp.stage)) ?? current;
  const tabs: [string, string][] = [["fixtures", "الجدول والمباريات"], ["table", stages.some((x) => x.format === "KNOCKOUT") ? "الترتيب والأدوار" : "الترتيب"], ["stages", `المراحل (${stages.length})`], ["scorers", "الهدافون"], ["discipline", "الإيقافات"], ["fairplay", "اللعب النظيف"],
    ...(c.squadListMax != null ? [["squads", "قوائم الموسم"] as [string, string]] : []), ["teams", `الفرق (${teams.length})`], ["settings", "الإعدادات"]];

  return (
    <>
      <PageHead title={c.name} sub={<>{season.name} — {stages.map((x) => x.name).join(" ← ")} — <Badge v={COMP_STATUS[c.status]} /></>} crumbs={[["المسابقات", "/competitions"], [c.name]]}
        actions={manage && (
          <form action={setCompetitionStatus} className="row">
            <input type="hidden" name="id" value={id} />
            <select name="status" defaultValue={c.status} style={{ width: "auto" }}>{Object.entries(COMP_STATUS).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</select>
            <Submit className="btn btn-light btn-sm">تحديث الحالة</Submit>
          </form>
        )} />
      <Flash sp={sp} />
      <div className="tabs">{tabs.map(([k, l]) => <Link key={k} href={`?tab=${k}`} className={`tab ${tab === k ? "active" : ""}`}>{l}</Link>)}</div>
      {tab === "fixtures" && <Fixtures id={id} manage={manage} teams={teams} stages={stages} stage={stage} />}
      {tab === "table" && <Table id={id} stages={stages} stage={stage} />}
      {tab === "stages" && <Stages id={id} manage={manage} stages={stages} stage={stage} teams={teams} />}
      {tab === "scorers" && <Scorers id={id} />}
      {tab === "discipline" && <Discipline id={id} />}
      {tab === "fairplay" && <FairPlay id={id} />}
      {tab === "squads" && c.squadListMax != null && <Squads c={c} teams={teams} clubId={sp.club ? Number(sp.club) : teams[0]?.club.id} canEdit={u.can("comp.lineups")} />}
      {tab === "teams" && <Teams id={id} manage={manage} teams={teams} groups={stages[0]?.format === "GROUPS"} />}
      {tab === "settings" && <Settings c={c} manage={manage} />}
    </>
  );
}

function StageTabs({ stages, stage, tab, only }: { stages: Stage[]; stage: Stage; tab: string; only?: (s: Stage) => boolean }) {
  const list = only ? stages.filter(only) : stages;
  if (list.length < 2) return null;
  return <div className="tabs sub">{list.map((x) => <Link key={x.id} href={`?tab=${tab}&stage=${x.id}`} className={`tab ${x.id === stage.id ? "active" : ""}`}>{x.seq}. {x.name}</Link>)}</div>;
}

async function Fixtures({ id, manage, teams, stages, stage }: { id: number; manage: boolean; teams: { club: { id: number; name: string } }[]; stages: Stage[]; stage: Stage }) {
  const h = alias(clubs, "h"), a = alias(clubs, "a");
  const ms = await db.select({ m: matches, home: h.name, away: a.name }).from(matches).innerJoin(h, eq(h.id, matches.homeClubId)).innerJoin(a, eq(a.id, matches.awayClubId))
    .where(and(eq(matches.competitionId, id), eq(matches.stageId, stage.id))).orderBy(asc(matches.round), asc(matches.tieNo), asc(matches.leg), asc(matches.kickoff), asc(matches.id));
  const rounds = [...new Set(ms.map((x) => x.m.round))];
  const ko = stage.format === "KNOCKOUT" ? await knockoutRounds(stage.id) : [];
  const sts = await allStadiums();
  const roundTitle = (r: number) => (stage.format === "KNOCKOUT" ? ko.find((x) => x.round === r)?.name ?? `الدور ${r}` : `الجولة ${r}`);
  return (
    <>
      <StageTabs stages={stages} stage={stage} tab="fixtures" />
      {manage && (
        <div className="card row">
          {ms.length === 0 ? (
            <form action={makeFixtures}><input type="hidden" name="id" value={id} /><input type="hidden" name="stageId" value={stage.id} />
              <Submit confirm={`إنشاء جدول «${stage.name}» تلقائيًا؟`}>⚙ إنشاء جدول {stage.name}</Submit></form>
          ) : (
            <form action={clearFixtures}><input type="hidden" name="id" value={id} /><input type="hidden" name="stageId" value={stage.id} />
              <Submit className="btn btn-ghost" confirm={`حذف كل مباريات «${stage.name}»؟`}>حذف جدول المرحلة</Submit></form>
          )}
          <details className="box" style={{ flex: 1, margin: 0 }}>
            <summary>+ مباراة يدوية في {stage.name}</summary>
            <form action={saveMatch} className="form f3 mt">
              <input type="hidden" name="competitionId" value={id} />
              <input type="hidden" name="stageId" value={stage.id} />
              <Field label="المضيف"><select name="homeClubId">{teams.map((t) => <option key={t.club.id} value={t.club.id}>{t.club.name}</option>)}</select></Field>
              <Field label="الضيف"><select name="awayClubId">{teams.map((t) => <option key={t.club.id} value={t.club.id}>{t.club.name}</option>)}</select></Field>
              <Field label={stage.format === "KNOCKOUT" ? "الدور" : "الجولة"}><input type="number" name="round" defaultValue={1} /></Field>
              {stage.format === "GROUPS" && <Field label="المجموعة"><input type="text" name="groupName" placeholder="أ" /></Field>}
              {stage.format === "KNOCKOUT" && <>
                <Field label="رقم المواجهة" hint="الذهاب والإياب بالرقم نفسه"><input type="number" name="tieNo" /></Field>
                <Field label="المباراة"><select name="leg"><option value="1">الذهاب / مباراة واحدة</option><option value="2">الإياب</option></select></Field>
              </>}
              <Field label="الموعد"><input type="datetime-local" name="kickoff" /></Field>
              <Field label="الملعب"><input type="text" name="venue" list="stadiums-list" /></Field>
              <div className="full"><Submit>إضافة</Submit></div>
            </form>
          </details>
          <Link className="btn btn-light" href={`/print/fixtures/${id}`} target="_blank">🖨 طباعة الجدول</Link>
        </div>
      )}
      <datalist id="stadiums-list">{sts.filter((x) => x.status !== "CLOSED").map((x) => <option key={x.id} value={x.name}>{x.city ?? ""}</option>)}</datalist>
      {ms.length === 0 ? <div className="card"><Empty>لم يُنشأ جدول هذه المرحلة بعد{stage.format !== "LEAGUE" && " — جهّز الفرق والمجموعات من تبويب «المراحل»"}</Empty></div> : (
        <form action={bulkSchedule}>
          <input type="hidden" name="competitionId" value={id} />
          {rounds.map((r) => (
            <div key={r} className="card table-wrap">
              <h3>{roundTitle(r)}</h3>
              <table className="t"><tbody>{ms.filter((x) => x.m.round === r).map(({ m, home, away }) => (
                <tr key={m.id}>
                  <td style={{ width: "32%" }}><strong>{home}</strong> × <strong>{away}</strong>
                    {m.groupName && <span className="b b-gray" style={{ marginInlineStart: 6 }}>المجموعة {m.groupName}</span>}
                    {m.tieNo != null && <span className="b b-gray" style={{ marginInlineStart: 6 }}>مواجهة {m.tieNo}{m.leg === 2 ? " — إياب" : m.leg === 1 && ms.some((x) => x.m.tieNo === m.tieNo && x.m.round === r && x.m.leg === 2) ? " — ذهاب" : ""}</span>}</td>
                  <td>{manage && m.reportStatus === "NONE" ? <><input type="hidden" name="mid" value={m.id} /><input type="datetime-local" name={`k_${m.id}`} defaultValue={toLocalInput(m.kickoff)} /></> : fmtDateTime(m.kickoff)}</td>
                  <td>{manage && m.reportStatus === "NONE" ? <input type="text" list="stadiums-list" name={`v_${m.id}`} defaultValue={m.venue ?? ""} placeholder="الملعب" /> : m.venue}</td>
                  <td className="num"><strong>{m.homeScore != null ? `${m.homeScore} - ${m.awayScore}` : "—"}</strong>{m.homePens != null && <div className="muted" style={{ fontSize: ".75rem" }}>ترجيح {m.homePens} - {m.awayPens}</div>}</td>
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

async function Table({ id, stages, stage }: { id: number; stages: Stage[]; stage: Stage }) {
  return (
    <>
      <StageTabs stages={stages} stage={stage} tab="table" />
      {stage.format === "KNOCKOUT" ? <Bracket stage={stage} /> : <StageTable id={id} stage={stage} />}
    </>
  );
}

async function StageTable({ id, stage }: { id: number; stage: Stage }) {
  const rows = await standings(id, stage.id);
  const groups = [...new Set(rows.map((r) => r.group ?? ""))];
  const q = stage.qualifyPerGroup ?? 0;
  return (
    <>
      <div className="row no-print" style={{ marginBottom: ".6rem" }}>
        <Link className="btn btn-light btn-sm" href={`/print/standings/${id}?stage=${stage.id}`} target="_blank">🖨 طباعة الترتيب</Link>
        {q > 0 && <span className="muted">المظلل: مراكز التأهل ({q} من {stage.format === "GROUPS" ? "كل مجموعة" : "الترتيب"})</span>}
      </div>
      {rows.length === 0 && <div className="card"><Empty>لا فرق في هذه المرحلة بعد</Empty></div>}
      {groups.map((g) => (
        <div key={g} className="card table-wrap">
          {g && <h3>المجموعة {g}</h3>}
          <table className="t"><thead><tr><th>#</th><th>الفريق</th><th className="num">لعب</th><th className="num">فاز</th><th className="num">تعادل</th><th className="num">خسر</th><th className="num">له</th><th className="num">عليه</th><th className="num">الفارق</th><th className="num">النقاط</th><th className="num">مخصوم</th></tr></thead>
            <tbody>{rows.filter((r) => (r.group ?? "") === g).map((r, i) => (
              <tr key={r.clubId} className={i < q ? "ok-row" : ""}><td>{i + 1}</td><td><strong>{r.name}</strong>{r.playoff && <span className="b b-amber" style={{ marginInlineStart: 6 }} title="تساوٍ تام وفق م24 — تُجرى مباراة فاصلة">مباراة فاصلة</span>}</td><td className="num">{r.p}</td><td className="num">{r.w}</td><td className="num">{r.d}</td><td className="num">{r.l}</td>
                <td className="num">{r.gf}</td><td className="num">{r.ga}</td><td className="num">{r.gd > 0 ? "+" : ""}{r.gd}</td><td className="num"><strong>{r.pts}</strong></td><td className="num">{r.deducted ? <span className="danger-text">−{r.deducted}</span> : ""}</td></tr>
            ))}</tbody></table>
        </div>
      ))}
    </>
  );
}

async function Bracket({ stage }: { stage: Stage }) {
  const rounds = await knockoutRounds(stage.id);
  const names = new Map((await db.select({ id: clubs.id, name: clubs.name }).from(clubs)).map((x) => [x.id, x.name]));
  if (!rounds.length) return <div className="card"><Empty>لم تُنشأ مواجهات خروج المغلوب بعد</Empty></div>;
  const last = rounds[rounds.length - 1];
  const champion = last.ties.length === 1 ? last.ties[0].winner : null;
  return (
    <>
      {champion && <div className="alert ok" style={{ fontSize: "1.1rem" }}>🏆 البطل: <strong>{names.get(champion)}</strong></div>}
      <div className="bracket">
        {rounds.map((r) => (
          <div key={r.round} className="card bracket-col">
            <h3>{r.name}</h3>
            {r.ties.map((t) => {
              const sum = (club: number) => t.legs.reduce((acc, m) => acc + (m.homeScore == null ? 0 : m.homeClubId === club ? m.homeScore : m.awayScore ?? 0), 0);
              const played = t.legs.some((m) => m.homeScore != null);
              const pens = t.legs.find((m) => m.homePens != null);
              return (
                <div key={t.tieNo} className="tie">
                  {[t.a, t.b].map((club) => (
                    <div key={club} className={`tie-team ${t.winner === club ? "win" : t.winner ? "lose" : ""}`}>
                      <span>{names.get(club)}</span><strong className="num">{played ? sum(club) : ""}</strong>
                    </div>
                  ))}
                  <div className="tie-meta">
                    {t.legs.map((m) => <Link key={m.id} href={`/matches/${m.id}`}>{t.legs.length > 1 ? (m.leg === 2 ? "الإياب" : "الذهاب") : "المباراة"}{m.homeScore != null ? ` ${m.homeScore}-${m.awayScore}` : ""}</Link>)}
                    {pens && <span>ترجيح {pens.homeClubId === t.a ? `${pens.homePens}-${pens.awayPens}` : `${pens.awayPens}-${pens.homePens}`}</span>}
                    {!t.winner && played && <span className="b b-amber">لم تُحسم</span>}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );
}

async function Stages({ id, manage, stages, stage, teams }: { id: number; manage: boolean; stages: Stage[]; stage: Stage; teams: { club: { id: number; name: string } }[] }) {
  const st = await db.select({ t: stageTeams, name: clubs.name }).from(stageTeams).innerJoin(clubs, eq(clubs.id, stageTeams.clubId)).where(eq(stageTeams.stageId, stage.id)).orderBy(stageTeams.groupName, stageTeams.fromGroup, stageTeams.seed, clubs.name);
  const counts = await db.select({ stageId: matches.stageId, n: sql<number>`count(*)::int`, done: sql<number>`sum(case when ${matches.status} in ('PLAYED','FORFEIT') then 1 else 0 end)::int` })
    .from(matches).where(eq(matches.competitionId, id)).groupBy(matches.stageId);
  const tcounts = await db.select({ stageId: stageTeams.stageId, n: sql<number>`count(*)::int` }).from(stageTeams)
    .where(sql`${stageTeams.stageId} in (select "competition_stages"."id" from "competition_stages" where "competition_stages"."competition_id" = ${id})`).groupBy(stageTeams.stageId);
  const mc = counts.find((x) => x.stageId === stage.id);
  const scheduled = (mc?.n ?? 0) > 0;
  const next = stages.find((x) => x.seq === stage.seq + 1);
  const inStage = new Set(st.map((x) => x.t.clubId));
  const groupsUsed = [...new Set(st.map((x) => x.t.groupName).filter(Boolean))] as string[];
  const letters = GROUP_LETTERS.slice(0, Math.max(stage.groupsCount ?? 2, groupsUsed.length, 2));
  return (
    <>
      <div className="stage-flow">
        {stages.map((x, i) => {
          const c = counts.find((k) => k.stageId === x.id), t = tcounts.find((k) => k.stageId === x.id);
          return (
            <span key={x.id} style={{ display: "contents" }}>
              {i > 0 && <span className="stage-arrow">←</span>}
              <Link href={`?tab=stages&stage=${x.id}`} className={`card stage-card ${x.id === stage.id ? "active" : ""}`}>
                <div className="muted">المرحلة {x.seq}</div>
                <strong>{x.name}</strong>
                <div>{STAGE_FORMAT[x.format]}{x.format === "GROUPS" && x.groupsCount ? ` (${x.groupsCount})` : ""} — <Badge v={STAGE_STATUS[x.status]} /></div>
                <div className="muted">{t?.n ?? 0} فريق — {c?.done ?? 0}/{c?.n ?? 0} مباراة</div>
              </Link>
            </span>
          );
        })}
        {manage && (
          <details className="card stage-card add">
            <summary>+ إضافة مرحلة</summary>
            <form action={addStage} className="form mt">
              <input type="hidden" name="id" value={id} />
              <StageFields />
              <Submit>إضافة</Submit>
            </form>
          </details>
        )}
      </div>

      <div className="grid g2">
        <div className="card table-wrap">
          <h3>فرق «{stage.name}» ({st.length})</h3>
          {st.length === 0 ? <Empty>{stage.seq > 1 ? "تُضاف الفرق تلقائيًا عند تأهيلها من المرحلة السابقة، أو أضفها يدويًا" : "أضف الفرق من تبويب «الفرق»"}</Empty> : (
            <form action={stageSaveGroups}>
              <input type="hidden" name="stageId" value={stage.id} />
              <table className="t"><tbody>{st.map(({ t, name }) => (
                <tr key={t.clubId}>
                  <td><strong>{name}</strong>{t.seed != null && <span className="b b-gray" style={{ marginInlineStart: 6 }}>{t.fromGroup ? `${t.fromGroup}${t.seed}` : `#${t.seed}`}</span>}</td>
                  <td>{stage.format === "GROUPS" && (manage && !scheduled ? (
                    <><input type="hidden" name="team" value={t.clubId} />
                      <select name={`g_${t.clubId}`} defaultValue={t.groupName ?? ""} style={{ width: "auto" }}><option value="">— المجموعة —</option>{letters.map((g) => <option key={g} value={g}>المجموعة {g}</option>)}</select></>
                  ) : t.groupName && `المجموعة ${t.groupName}`)}</td>
                  <td>{manage && !scheduled && <button formAction={stageRemoveTeam} name="clubId" value={t.clubId} className="btn btn-sm btn-ghost">حذف</button>}</td>
                </tr>
              ))}</tbody></table>
              {manage && !scheduled && stage.format === "GROUPS" && <div className="mt"><Submit className="btn btn-light">💾 حفظ التوزيع اليدوي</Submit></div>}
            </form>
          )}
          {manage && !scheduled && (
            <details className="mt">
              <summary>+ إضافة فرق لهذه المرحلة يدويًا</summary>
              <form action={stageAddTeams} className="mt">
                <input type="hidden" name="stageId" value={stage.id} />
                <div className="chk-grid">{teams.filter((t) => !inStage.has(t.club.id)).map((t) => <label key={t.club.id} className="check"><input type="checkbox" name="club" value={t.club.id} /> {t.club.name}</label>)}</div>
                <div className="mt"><Submit className="btn btn-light">إضافة المحدد</Submit></div>
              </form>
            </details>
          )}
        </div>

        <div>
          {manage && (
            <div className="card">
              <h3>الإجراءات</h3>
              {stage.format === "GROUPS" && !scheduled && (
                <form action={stageDraw} className="row">
                  <input type="hidden" name="stageId" value={stage.id} />
                  <Field label="عدد المجموعات"><input type="number" name="groupsCount" min={2} max={12} defaultValue={stage.groupsCount ?? 2} style={{ width: 90 }} /></Field>
                  <Submit className="btn btn-light" confirm="قرعة عشوائية لتوزيع الفرق على المجموعات؟ (يلغي التوزيع الحالي)">🎲 قرعة المجموعات</Submit>
                </form>
              )}
              <div className="row mt">
                {!scheduled ? (
                  <form action={makeFixtures}><input type="hidden" name="id" value={id} /><input type="hidden" name="stageId" value={stage.id} />
                    <Submit confirm={`إنشاء جدول «${stage.name}»؟`}>⚙ إنشاء جدول المرحلة</Submit></form>
                ) : (
                  <form action={clearFixtures}><input type="hidden" name="id" value={id} /><input type="hidden" name="stageId" value={stage.id} />
                    <Submit className="btn btn-ghost" confirm="حذف كل مباريات المرحلة؟">حذف جدول المرحلة</Submit></form>
                )}
                {scheduled && <Link className="btn btn-light" href={`?tab=fixtures&stage=${stage.id}`}>المباريات والمواعيد</Link>}
              </div>
              {stage.format === "KNOCKOUT" && scheduled && (
                <form action={stageNextRound} className="mt">
                  <input type="hidden" name="stageId" value={stage.id} />
                  <Submit className="btn" confirm="إنشاء الدور التالي من الفائزين (أو إعلان البطل إن كان النهائي محسومًا)؟">⏭ إنشاء الدور التالي / إعلان البطل</Submit>
                  <p className="muted" style={{ fontSize: ".8rem" }}>يُحسب الفائز بمجموع المباراتين، وعند التعادل بركلات الترجيح المسجلة في صفحة آخر مباراة.</p>
                </form>
              )}
              {stage.format !== "KNOCKOUT" && next && (
                <form action={stageQualify} className="row mt">
                  <input type="hidden" name="stageId" value={stage.id} />
                  <Field label={`المتأهلون من ${stage.format === "GROUPS" ? "كل مجموعة" : "الترتيب"}`}><input type="number" name="perGroup" min={1} defaultValue={stage.qualifyPerGroup ?? 2} style={{ width: 90 }} /></Field>
                  <Submit confirm={`تأهيل الأوائل إلى «${next.name}»؟ تُعتبر هذه المرحلة منتهية.`}>✅ تأهيل إلى «{next.name}»</Submit>
                </form>
              )}
            </div>
          )}
          {manage && (
            <details className="card">
              <summary>إعدادات المرحلة</summary>
              <form action={saveStage} className="form mt">
                <input type="hidden" name="stageId" value={stage.id} />
                <StageFields s={stage} />
                <div className="row"><Submit>حفظ</Submit>
                  {!scheduled && stages.length > 1 && <button formAction={deleteStage} className="btn btn-ghost">حذف المرحلة</button>}</div>
              </form>
            </details>
          )}
        </div>
      </div>
    </>
  );
}

function StageFields({ s }: { s?: Stage }) {
  return (
    <div className="form f2">
      <Field label="اسم المرحلة"><input type="text" name="name" defaultValue={s?.name ?? ""} placeholder="مثال: سداسي التتويج" required /></Field>
      <Field label="النظام"><select name="format" defaultValue={s?.format ?? "LEAGUE"}><Options map={STAGE_FORMAT} /></select></Field>
      <Field label="الأدوار / المباريات" hint="دوري ومجموعات: 1 أو 2 دور — خروج المغلوب: 1 مباراة أو 2 ذهاب وإياب"><input type="number" name="legs" min={1} max={4} defaultValue={s?.legs ?? 2} /></Field>
      <Field label="النهائي (خروج المغلوب)"><select name="finalLegs" defaultValue={s?.finalLegs ?? 1}><option value="1">مباراة واحدة</option><option value="2">ذهاب وإياب</option></select></Field>
      <Field label="عدد المجموعات"><input type="number" name="groupsCount" min={2} max={12} defaultValue={s?.groupsCount ?? ""} /></Field>
      <Field label="المتأهلون للمرحلة التالية" hint="من كل مجموعة أو من الترتيب"><input type="number" name="qualifyPerGroup" min={1} defaultValue={s?.qualifyPerGroup ?? ""} /></Field>
    </div>
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
      <Field label="النظام عند الإنشاء" hint="المراحل تُدار من تبويب «المراحل»"><select name="type" defaultValue={c.type}><Options map={COMP_TYPE} /></select></Field>
      <Field label="كسر التعادل في الترتيب"><select name="tiebreak" defaultValue={c.tiebreak}><Options map={TIEBREAK} /></select></Field>
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
      <Field label="التبديلات المسموحة" hint="م65: الكبار والشباب 3، الآمال 5"><input type="number" name="maxSubs" defaultValue={c.maxSubs} /></Field>
      <Field label="تبديل إضافي في الوقت الإضافي"><input type="number" name="maxSubsExtra" defaultValue={c.maxSubsExtra} /></Field>
      <Field label="لاعبو الفئة الأدنى في القائمة" hint="م69: 3 — فارغ = بلا حد"><input type="number" name="maxLowerCategory" defaultValue={c.maxLowerCategory ?? ""} /></Field>
      <Field label="حارس المرمى الأجنبي" hint="م71"><select name="noForeignGK" defaultValue={c.noForeignGK ? "1" : "0"}><option value="1">غير مسموح</option><option value="0">مسموح</option></select></Field>
      <Field label="النتيجة الاعتبارية للمتسبب" hint="م42 و43 و68: صفر - 2"><input type="number" name="forfeitGoals" min={1} defaultValue={c.forfeitGoals} /></Field>
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
