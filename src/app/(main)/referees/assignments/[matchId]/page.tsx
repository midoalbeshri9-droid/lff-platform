import Link from "next/link";
import { WaButton } from "@/components/WaButton";
import { appUrl } from "@/lib/tokens";
import { notFound } from "next/navigation";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { matches, clubs, competitions, assignments, officials, evaluations } from "@/db/schema";
import { scopeOf, compIn, officialIn, guard, guardPage, inScopeOfficial, inScopeMatch } from "@/lib/scope";
import { requireUser } from "@/lib/auth";
import { checkAssignment } from "@/lib/assign";
import { ASSIGN_ROLE, ASSIGN_ROLE_INPUT, ASSIGN_STATUS, ROLE_FITS, OFFICIAL_GRADE, OBSERVER_ROLES } from "@/lib/labels";
import { fmtDateTime } from "@/lib/util";
import { PageHead, Flash, Badge, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { assignOfficial, approveAssignments } from "../../actions";

export default async function AssignMatch({ params, searchParams }: { params: Promise<{ matchId: string }>; searchParams: SP }) {
  const u = await requireUser("ref.view", "comp.observers");
  const id = Number((await params).matchId);
  const sp = await searchParams;
  const [m] = await db.select().from(matches).where(eq(matches.id, id));
  if (!m) notFound();
  guardPage(await inScopeMatch(u, id));
  const sc = await scopeOf(u);
  const [c] = await db.select().from(competitions).where(eq(competitions.id, m.competitionId));
  const cl = await db.select().from(clubs).where(inArray(clubs.id, [m.homeClubId, m.awayClubId]));
  const cur = await db.select({ a: assignments, name: officials.fullName, phone: officials.phone }).from(assignments).innerJoin(officials, eq(officials.id, assignments.officialId)).where(eq(assignments.matchId, id));
  const all0 = await db.select().from(officials).where(and(eq(officials.status, "ACTIVE"), officialIn(sc, officials.id))).orderBy(officials.grade, officials.fullName);
  // ترتيب المرشحين: الأعلى تقييمًا أولًا (متوسط تقييمات المراقبين المرسلة) مع عدد المباريات
  const stats = new Map((await db.select({ id: evaluations.officialId, avg: sql<number>`round(avg(${evaluations.score})::numeric, 2)::float`, n: sql<number>`count(*)::int` })
    .from(evaluations).where(eq(evaluations.isSubmitted, true)).groupBy(evaluations.officialId)).map((x) => [x.id, x]));
  const all = [...all0].sort((a, b) => (stats.get(b.id)?.avg ?? -1) - (stats.get(a.id)?.avg ?? -1));
  const tag = (id: number) => { const s = stats.get(id); return s ? ` ★${s.avg} (${s.n})` : ""; };
  const open = m.reportStatus !== "APPROVED";
  const canRole = (role: string) => open && (OBSERVER_ROLES.includes(role) ? u.can("comp.observers") : u.can("ref.assign"));
  const can = open && u.canAny("ref.assign", "comp.observers");
  // فحص التعارضات للمعيّنين حاليًا
  const checks = await Promise.all(cur.map(async (x) => ({ id: x.a.id, ...(await checkAssignment(id, x.a.officialId, x.a.role)) })));
  const home = cl.find((x) => x.id === m.homeClubId)!, away = cl.find((x) => x.id === m.awayClubId)!;
  const assignMsg = (role: string, name: string) => `الاتحاد الليبي لكرة القدم\nالسيد/ ${name}\nتم تعيينكم (${role}) في مباراة ${home.name} × ${away.name} — ${c.name} الجولة ${m.round ?? ""}\nالموعد: ${fmtDateTime(m.kickoff)}${m.venue ? `\nالملعب: ${m.venue}` : ""}\nتفاصيل المباراة وتقريرك في البوابة: ${appUrl()}/portal`;
  return (
    <>
      <PageHead title={`طاقم: ${home.name} × ${away.name}`} sub={`${c.name} — ج${m.round} — ${fmtDateTime(m.kickoff)} — ${m.venue ?? ""} (${home.city ?? ""} / ${away.city ?? ""})`}
        crumbs={u.can("ref.view") ? [["تعيين الطواقم", "/referees/assignments"], ["المباراة"]] : [["المباريات", "/matches"], ["الطاقم"]]} actions={<Link className="btn btn-light" href={`/matches/${id}?tab=officials`}>صفحة المباراة</Link>} />
      <Flash sp={sp} />
      <div className="card table-wrap">
        <table className="t"><thead><tr><th>الدور</th><th>المعيّن</th><th>الحالة</th><th>إبلاغ</th><th>الفحص</th>{can && <th>تعيين / تغيير</th>}</tr></thead>
          <tbody>{Object.entries(ASSIGN_ROLE_INPUT).filter(([role]) => !OBSERVER_ROLES.includes(role) || u.can("comp.observers")).map(([role, label]) => {
            const x = cur.find((y) => y.a.role === role || (role === "COMMISSIONER" && y.a.role === "REF_OBSERVER"));
            const ch = x && checks.find((k) => k.id === x.a.id);
            return (
              <tr key={role}>
                <td><strong>{label}</strong></td>
                <td>{x?.name ?? <span className="muted">—</span>}</td>
                <td>{x && <Badge v={ASSIGN_STATUS[x.a.status]} />}{x?.a.declineReason && <div className="danger-text" style={{ fontSize: ".8rem" }}>{x.a.declineReason}</div>}</td>
                <td>{x && x.a.status !== "DECLINED" && <WaButton phone={x.phone} text={assignMsg(label, x.name)} />}</td>
                <td>{ch && (ch.errors.length ? <span className="bad-mark">✗ {ch.errors.join("، ")}</span> : ch.warnings.length ? <span className="b b-amber">⚠ {ch.warnings.join("، ")}</span> : <span className="ok-mark">✓</span>)}</td>
                {can && (
                  <td>
                    {!canRole(role) ? <span className="muted" style={{ fontSize: ".85rem" }}>{OBSERVER_ROLES.includes(role) ? "يعيّنه لجنة المسابقات" : "تعيّنه لجنة الحكام"}</span> : (
                    <form action={assignOfficial} className="row">
                      <input type="hidden" name="matchId" value={id} /><input type="hidden" name="role" value={role} />
                      <select name="officialId" defaultValue={x?.a.officialId ?? ""} style={{ minWidth: 220 }}>
                        <option value="">— بدون —</option>
                        {all.filter((o) => ROLE_FITS[role].includes(o.type)).map((o) => <option key={o.id} value={o.id}>{o.fullName} ({OFFICIAL_GRADE[o.grade]}{o.city ? ` — ${o.city}` : ""}){tag(o.id)}</option>)}
                      </select>
                      <label className="check" title="تجاوز التحذيرات (ليس الأخطاء المانعة)"><input type="checkbox" name="force" /> تجاوز</label>
                      <Submit className="btn btn-sm btn-light">حفظ</Submit>
                    </form>
                    )}
                  </td>
                )}
              </tr>
            );
          })}</tbody></table>
      </div>
      {u.can("ref.approve") && cur.some((x) => x.a.status === "DRAFT" && !OBSERVER_ROLES.includes(x.a.role)) && (
        <form action={approveAssignments} className="card row">
          <input type="hidden" name="matchId" value={id} />
          <span>اعتماد التعيينات يرسل إشعارًا لكل حكم ويظهرها للجنة المسابقات. (مراقب المباراة تعيّنه لجنة المسابقات ويُعتمد مباشرة.)</span>
          <span className="spacer" />
          <Submit confirm="اعتماد كل التعيينات المسودة؟">✓ اعتماد الطاقم</Submit>
        </form>
      )}
      <p className="muted">يمنع النظام تلقائيًا: الحكم الموقوف أو المصاب، الراسب في اللياقة، منتهي الرخصة، المعيّن في نفس اليوم. ويحذّر من: نفس مدينة أحد الفريقين، وتكرار إدارة مباريات الفريقين.</p>
    </>
  );
}
