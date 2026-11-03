import Link from "next/link";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { competitions, clubs, matches, settings } from "@/db/schema";
import { scopeOf, compIn, clubIn } from "@/lib/scope";
import { requireUser } from "@/lib/auth";
import { calendarMatches, findConflicts, type Conflict } from "@/lib/calendar";
import { PageHead, Flash, Field, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { saveRestHours } from "../actions";

const DAYS = ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"];
const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const KIND: Record<Conflict["kind"], string> = { REST: "🕑 راحة غير كافية", STADIUM: "🏟 ملعب محجوز مرتين", STADIUM_STATUS: "⛔ ملعب موقوف", REFEREE: "🟨 حكم في مباراتين" };
const pad = (n: number) => String(n).padStart(2, "0");
const ly = (d: Date) => new Date(d.getTime() + 2 * 3600e3); // توقيت ليبيا

export default async function Calendar({ searchParams }: { searchParams: SP }) {
  const u = await requireUser("comp.view");
  const sp = await searchParams;
  const now = ly(new Date());
  const [y, mo] = (sp.m ?? `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}`).split("-").map(Number);
  const from = new Date(Date.UTC(y, mo - 1, 1, -2)), to = new Date(Date.UTC(y, mo, 1, -2) - 1);
  const compId = sp.comp ? Number(sp.comp) : undefined, clubId = sp.club ? Number(sp.club) : undefined;
  const sc = await scopeOf(u);
  const ms = (await calendarMatches(from, to, { compId, clubId })).filter((m) => !sc || sc.compIds.includes(m.compId));
  const conflicts = (await findConflicts(from, to)).filter((c) => (!compId && !clubId && !sc) ? true : c.matchIds.some((id) => ms.some((m) => m.id === id)));
  const bad = new Set(conflicts.flatMap((c) => c.matchIds));
  const [{ n: unscheduled }] = await db.select({ n: sql<number>`count(*)::int` }).from(matches)
    .where(and(isNull(matches.kickoff), ne(matches.status, "CANCELLED"), compId ? eq(matches.competitionId, compId) : undefined, compIn(sc, matches.competitionId)));
  const comps = await db.select({ id: competitions.id, name: competitions.name }).from(competitions).where(and(ne(competitions.status, "FINISHED"), compIn(sc, competitions.id)));
  const cl = await db.select({ id: clubs.id, name: clubs.name }).from(clubs).where(and(eq(clubs.isActive, true), clubIn(sc, clubs.id))).orderBy(clubs.name);
  const [rest] = await db.select().from(settings).where(eq(settings.key, "min_rest_hours"));

  // شبكة الشهر تبدأ بالسبت
  const first = new Date(Date.UTC(y, mo - 1, 1));
  const lead = (first.getUTCDay() + 1) % 7;
  const daysIn = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const dayKey = (d: number) => `${y}-${pad(mo)}-${pad(d)}`;
  const byDay = new Map<string, typeof ms>();
  for (const m of ms) { const k = ly(m.kickoff!).toISOString().slice(0, 10); byDay.set(k, [...(byDay.get(k) ?? []), m]); }
  const qs = (m: string) => `?m=${m}${compId ? `&comp=${compId}` : ""}${clubId ? `&club=${clubId}` : ""}`;
  const prev = mo === 1 ? `${y - 1}-12` : `${y}-${pad(mo - 1)}`, next = mo === 12 ? `${y + 1}-01` : `${y}-${pad(mo + 1)}`;
  const todayKey = now.toISOString().slice(0, 10);

  return (
    <>
      <PageHead title="التقويم الموسمي" sub="كل المباريات على التقويم مع كشف التعارضات تلقائيًا" />
      <Flash sp={sp} />
      <form className="filters">
        <input type="hidden" name="m" value={`${y}-${pad(mo)}`} />
        <div className="field"><label>المسابقة</label><select name="comp" defaultValue={compId ?? ""}><option value="">الكل</option>{comps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field"><label>النادي</label><select name="club" defaultValue={clubId ?? ""}><option value="">الكل</option>{cl.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <button className="btn btn-light">عرض</button>
      </form>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: ".6rem" }}>
        <Link className="btn btn-light btn-sm" href={qs(prev)}>→ الشهر السابق</Link>
        <h2 style={{ margin: 0 }}>{MONTHS[mo - 1]} {y}</h2>
        <Link className="btn btn-light btn-sm" href={qs(next)}>الشهر التالي ←</Link>
      </div>
      <div className="row" style={{ marginBottom: ".6rem" }}>
        <span className="b b-gray">{ms.length} مباراة هذا الشهر</span>
        {conflicts.length > 0 ? <span className="b b-red">{conflicts.length} تعارض</span> : <span className="b b-green">لا تعارضات</span>}
        {unscheduled > 0 && <span className="b b-amber">{unscheduled} مباراة بلا موعد</span>}
      </div>
      <div className="cal">
        {DAYS.map((d) => <div key={d} className="cal-h">{d}</div>)}
        {cells.map((d, i) => {
          const list = d ? byDay.get(dayKey(d)) ?? [] : [];
          return (
            <div key={i} className={`cal-d ${d ? "" : "empty"} ${d && dayKey(d) === todayKey ? "today" : ""}`}>
              {d && <div className="cal-n">{d}</div>}
              {list.map((m) => (
                <Link key={m.id} href={`/matches/${m.id}`} className={`cal-m ${bad.has(m.id) ? "bad" : ""} ${m.status !== "SCHEDULED" ? "done" : ""}`} title={`${m.comp} — ${m.venue ?? ""}`}>
                  <span className="num">{ly(m.kickoff!).toISOString().slice(11, 16)}</span> {m.home} × {m.away}
                </Link>
              ))}
            </div>
          );
        })}
      </div>
      <div className="grid g2 mt">
        <div className="card table-wrap">
          <h3>التعارضات ({conflicts.length})</h3>
          {conflicts.length === 0 ? <p className="muted">لا توجد تعارضات في هذا الشهر ✓</p> : (
            <table className="t"><tbody>{conflicts.map((c, i) => (
              <tr key={i} className="danger"><td className="nowrap">{c.day}</td><td>{KIND[c.kind]}</td><td>{c.text}</td>
                <td className="nowrap">{c.matchIds.map((id) => <Link key={id} href={`/matches/${id}?tab=info`} style={{ marginInlineEnd: 6 }}>#{id}</Link>)}</td></tr>
            ))}</tbody></table>
          )}
        </div>
        {u.can("comp.manage") && !sc && (
          <form action={saveRestHours} className="card form">
            <h3>قواعد الكشف</h3>
            <Field label="أقل فاصل بين مباراتين للنادي (ساعة)" hint="م49 تمنح 3-4 أيام راحة بعد المباريات الخارجية"><input type="number" name="hours" min={12} defaultValue={rest?.value ?? "48"} /></Field>
            <Submit className="btn btn-light">حفظ</Submit>
          </form>
        )}
      </div>
    </>
  );
}
