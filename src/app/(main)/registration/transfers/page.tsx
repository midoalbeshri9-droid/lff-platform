import Link from "next/link";
import { and, eq, desc, inArray, isNotNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { registrations, players, clubs, seasons } from "@/db/schema";
import { scopeOf, clubIn, regIn, guardPage, inScopeReg, inScopePlayer } from "@/lib/scope";
import { requireUser } from "@/lib/auth";
import { getCurrentSeason } from "@/lib/registration";
import { REG_STATUS, REG_TYPE, ORIGIN } from "@/lib/labels";
import { fmtDate, today } from "@/lib/util";
import { PageHead, Badge, Empty, type SP } from "@/components/ui";

export default async function Transfers({ searchParams }: { searchParams: SP }) {
  const u = await requireUser("reg.view");
  const sc = await scopeOf(u);
  const sp = await searchParams;
  const cur = await getCurrentSeason();
  const ss = await db.select().from(seasons).orderBy(desc(seasons.startDate));
  const seasonId = Number(sp.season ?? cur?.id ?? 0);
  const fc = alias(clubs, "fc");
  const rows = await db
    .select({ r: registrations, name: players.fullName, to: clubs.name, from: fc.name })
    .from(registrations).innerJoin(players, eq(players.id, registrations.playerId)).innerJoin(clubs, eq(clubs.id, registrations.clubId))
    .leftJoin(fc, eq(fc.id, registrations.fromClubId))
    .where(and(regIn(sc), eq(registrations.seasonId, seasonId), inArray(registrations.type, ["TRANSFER", "LOAN", "LOAN_RETURN"]),
      sp.type ? eq(registrations.type, sp.type as "LOAN") : undefined, isNotNull(registrations.submittedAt)))
    .orderBy(desc(registrations.decidedAt), desc(registrations.id));
  const t = today();
  const loansEnding = rows.filter((x) => x.r.type === "LOAN" && x.r.status === "APPROVED" && x.r.loanEndDate && x.r.loanEndDate <= new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10));
  return (
    <>
      <PageHead title="سجل الانتقالات والإعارات" />
      <form className="filters">
        <div className="field"><label>الموسم</label><select name="season" defaultValue={String(seasonId)}>{ss.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div className="field"><label>النوع</label><select name="type" defaultValue={sp.type ?? ""}><option value="">الكل</option><option value="TRANSFER">انتقال نهائي</option><option value="LOAN">إعارة</option><option value="LOAN_RETURN">عودة من إعارة</option></select></div>
        <button className="btn btn-light">عرض</button>
      </form>
      {loansEnding.length > 0 && <div className="alert warn">⏰ {loansEnding.length} إعارة تنتهي خلال 30 يومًا: {loansEnding.map((x) => `${x.name} (${fmtDate(x.r.loanEndDate)})`).join("، ")}</div>}
      <div className="card table-wrap">
        {rows.length === 0 ? <Empty>لا توجد انتقالات</Empty> : (
          <table className="t"><thead><tr><th>اللاعب</th><th>النوع</th><th>من</th><th>إلى</th><th>رد النادي السابق</th><th>نهاية الإعارة</th><th>الحالة</th><th>تاريخ القرار</th><th></th></tr></thead>
            <tbody>{rows.map(({ r, name, to, from }) => (
              <tr key={r.id} className={r.type === "LOAN" && r.loanEndDate && r.loanEndDate < t && r.status === "APPROVED" ? "danger" : ""}>
                <td><strong>{name}</strong></td><td>{REG_TYPE[r.type]}</td><td>{from ?? "—"}</td><td>{to}</td>
                <td><Badge v={ORIGIN[r.originResponse]} /></td><td>{fmtDate(r.loanEndDate)}</td>
                <td><Badge v={REG_STATUS[r.status]} /></td><td>{fmtDate(r.decidedAt?.toISOString())}</td>
                <td><Link href={`/registration/requests/${r.id}`}>عرض</Link></td>
              </tr>))}</tbody></table>
        )}
      </div>
    </>
  );
}
