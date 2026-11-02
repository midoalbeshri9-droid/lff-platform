import { and, eq, desc } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { clubs, players, registrations, staff, competitions, matches, sanctionArticles } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getCurrentSeason } from "@/lib/registration";
import { SANCTION_TYPE, SANCTION_TARGET, SANCTION_FOR, STAFF_ROLE } from "@/lib/labels";
import { today, fmtDateTime } from "@/lib/util";
import { PageHead, Flash, Field, type SP } from "@/components/ui";
import { Submit, AutoSubmitSelect } from "@/components/Client";
import { createSanction } from "../actions";

export default async function NewSanction({ searchParams }: { searchParams: SP }) {
  await requireUser("comp.sanctions");
  const sp = await searchParams;
  const season = await getCurrentSeason();
  const target = (sp.target ?? "PLAYER") as "PLAYER" | "STAFF" | "CLUB";
  // من صفحة المباراة: تُعبأ المباراة والمسابقة تلقائيًا
  const matchId = sp.match ? Number(sp.match) : null;
  const h = alias(clubs, "h"), a = alias(clubs, "a");
  const [m] = matchId ? await db.select({ m: matches, home: h.name, away: a.name }).from(matches).innerJoin(h, eq(h.id, matches.homeClubId)).innerJoin(a, eq(a.id, matches.awayClubId)).where(eq(matches.id, matchId)) : [];
  const allClubs = await db.select({ id: clubs.id, name: clubs.name }).from(clubs).orderBy(clubs.name);
  const clubOpts = m ? allClubs.filter((c) => c.id === m.m.homeClubId || c.id === m.m.awayClubId) : allClubs;
  const clubId = sp.club ? Number(sp.club) : clubOpts[0]?.id;
  const [plist, slist, comps, arts] = await Promise.all([
    clubId && target === "PLAYER" ? db.select({ id: players.id, name: players.fullName, num: registrations.number }).from(registrations).innerJoin(players, eq(players.id, registrations.playerId))
      .where(and(eq(registrations.clubId, clubId), eq(registrations.seasonId, season?.id ?? 0), eq(registrations.status, "APPROVED"))).orderBy(players.fullName) : [],
    clubId && target === "STAFF" ? db.select().from(staff).where(and(eq(staff.clubId, clubId), eq(staff.seasonId, season?.id ?? 0))).orderBy(staff.fullName) : [],
    db.select({ id: competitions.id, name: competitions.name }).from(competitions).orderBy(desc(competitions.id)),
    db.select().from(sanctionArticles).where(eq(sanctionArticles.isActive, true)).orderBy(sanctionArticles.code),
  ]);
  const types = SANCTION_FOR[target];
  return (
    <>
      <PageHead title="قرار عقوبة جديد" crumbs={[["العقوبات", "/competitions/sanctions"], ["جديد"]]} />
      <Flash sp={sp} />
      {m && <div className="alert info">مرتبط بالمباراة: <strong>{m.home} × {m.away}</strong> — الجولة {m.m.round} — {fmtDateTime(m.m.kickoff)}</div>}
      <form className="card filters">
        {matchId && <input type="hidden" name="match" value={matchId} />}
        <div className="field"><label>الجهة المعاقبة</label><AutoSubmitSelect name="target" defaultValue={target}>{Object.entries(SANCTION_TARGET).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</AutoSubmitSelect></div>
        <div className="field"><label>النادي</label><AutoSubmitSelect name="club" defaultValue={String(clubId ?? "")}>{clubOpts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</AutoSubmitSelect></div>
        <noscript><button className="btn btn-light">تحديث</button></noscript>
      </form>
      <form action={createSanction} className="card form f3">
        <input type="hidden" name="targetType" value={target} />
        <input type="hidden" name="clubId" value={clubId ?? ""} />
        {matchId && <input type="hidden" name="matchId" value={matchId} />}
        {target === "PLAYER" && <Field label="اللاعب *"><select name="playerId" required><option value="">— اختر —</option>{plist.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.num})</option>)}</select></Field>}
        {target === "STAFF" && <Field label="الإداري *"><select name="staffId" required><option value="">— اختر —</option>{slist.map((s) => <option key={s.id} value={s.id}>{s.fullName} — {STAFF_ROLE[s.role]}</option>)}</select></Field>}
        <Field label="نوع العقوبة *"><select name="type" required>{types.map((t) => <option key={t} value={t}>{SANCTION_TYPE[t]}</option>)}</select></Field>
        <Field label="المسابقة"><select name="competitionId" defaultValue={m?.m.competitionId ?? ""}><option value="">—</option>{comps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="المادة من اللائحة" hint={arts.length ? undefined : "اللائحة لم تُدخل بعد — اكتب المادة يدويًا"}>
          {arts.length > 0 ? <select name="articleId"><option value="">— اختر —</option>{arts.map((a2) => <option key={a2.id} value={a2.id}>المادة {a2.code}: {a2.title}</option>)}</select> : <input type="text" name="articleText" placeholder="مثال: المادة 25 من لائحة الانضباط" />}
        </Field>
        <Field label="عدد المباريات (للإيقاف)"><input type="number" name="matchesCount" min={1} /></Field>
        <Field label="من تاريخ"><input type="date" name="fromDate" defaultValue={today()} /></Field>
        <Field label="إلى تاريخ (للإيقاف بمدة / منع التسجيل)"><input type="date" name="toDate" /></Field>
        <Field label="النقاط المخصومة"><input type="number" name="points" min={1} /></Field>
        <Field label="الغرامة (د.ل)" hint="تُضاف تلقائيًا لحساب النادي لدى اللجنة المالية"><input type="number" step="0.01" name="fineAmount" min={0} /></Field>
        <Field label="تاريخ القرار"><input type="date" name="decisionDate" defaultValue={today()} /></Field>
        <Field label="الوقائع والأسباب *" full><textarea name="reason" required className="tall" style={{ minHeight: 120 }} /></Field>
        <Field label="ملاحظات داخلية" full><textarea name="notes" /></Field>
        <div className="full"><Submit confirm="إصدار القرار وتطبيق آثاره وإبلاغ النادي؟">⚖ إصدار القرار</Submit></div>
      </form>
    </>
  );
}
