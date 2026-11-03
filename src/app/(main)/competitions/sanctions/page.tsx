import Link from "next/link";
import { and, eq, desc } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { sanctions, clubs, players, staff, competitions } from "@/db/schema";
import { scopeOf, clubIn, compIn, officialIn, regIn, guardPage, inScopeClub, inScopeComp, inScopeMatch, inScopePlayer, inScopeReg, inScopeOfficial, inScopeSanction, inScopeStaff } from "@/lib/scope";
import { requireUser } from "@/lib/auth";
import { SANCTION_TYPE, SANCTION_TARGET, SANCTION_STATUS } from "@/lib/labels";
import { fmtDate, money } from "@/lib/util";
import { PageHead, Flash, Badge, Empty, Options, type SP } from "@/components/ui";

export default async function Sanctions({ searchParams }: { searchParams: SP }) {
  const u = await requireUser("comp.view", "comp.sanctions");
  const sp = await searchParams;
  const sc = await scopeOf(u);
  const cl = await db.select({ id: clubs.id, name: clubs.name }).from(clubs).where(clubIn(sc, clubs.id)).orderBy(clubs.name);
  const rows = await db.select({ s: sanctions, club: clubs.name, player: players.fullName, staffName: staff.fullName, comp: competitions.name })
    .from(sanctions).innerJoin(clubs, eq(clubs.id, sanctions.clubId)).leftJoin(players, eq(players.id, sanctions.playerId))
    .leftJoin(staff, eq(staff.id, sanctions.staffId)).leftJoin(competitions, eq(competitions.id, sanctions.competitionId))
    .where(and(clubIn(sc, sanctions.clubId), sp.club ? eq(sanctions.clubId, Number(sp.club)) : undefined, sp.type ? eq(sanctions.type, sp.type as "FINE") : undefined,
      sp.target ? eq(sanctions.targetType, sp.target as "CLUB") : undefined, sp.status ? eq(sanctions.status, sp.status as "ACTIVE") : undefined))
    .orderBy(desc(sanctions.id)).limit(400);
  void alias;
  return (
    <>
      <PageHead title="العقوبات والقرارات" sub="قرارات لجنة المسابقات على الأندية واللاعبين والإداريين — تُطبق آثارها تلقائيًا"
        actions={<>{u.can("comp.articles") && <Link className="btn btn-light" href="/competitions/articles">📖 لائحة العقوبات</Link>}{u.can("comp.sanctions") && <Link className="btn btn-primary" href="/competitions/sanctions/new">+ قرار عقوبة</Link>}</>} />
      <Flash sp={sp} />
      <form className="filters">
        <div className="field"><label>النادي</label><select name="club" defaultValue={sp.club ?? ""}><option value="">الكل</option>{cl.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field"><label>الجهة</label><select name="target" defaultValue={sp.target ?? ""}><option value="">الكل</option><Options map={SANCTION_TARGET} /></select></div>
        <div className="field"><label>النوع</label><select name="type" defaultValue={sp.type ?? ""}><option value="">الكل</option><Options map={SANCTION_TYPE} /></select></div>
        <div className="field"><label>الحالة</label><select name="status" defaultValue={sp.status ?? ""}><option value="">الكل</option><Options map={SANCTION_STATUS} /></select></div>
        <button className="btn btn-light">تصفية</button>
      </form>
      <div className="card table-wrap">
        {rows.length === 0 ? <Empty>لا توجد قرارات</Empty> : (
          <table className="t"><thead><tr><th>رقم القرار</th><th>التاريخ</th><th>المعاقَب</th><th>النادي</th><th>العقوبة</th><th>التفاصيل</th><th>المسابقة</th><th>الحالة</th><th></th></tr></thead>
            <tbody>{rows.map(({ s, club, player, staffName, comp }) => (
              <tr key={s.id}>
                <td className="kbd">{s.number}</td><td>{fmtDate(s.decisionDate)}</td>
                <td>{s.targetType === "CLUB" ? <span className="b b-indigo">النادي</span> : <><strong>{player ?? staffName}</strong> <small className="muted">({SANCTION_TARGET[s.targetType]})</small></>}</td>
                <td>{club}</td><td>{SANCTION_TYPE[s.type]}</td>
                <td style={{ fontSize: ".85rem" }}>{[s.matchesCount && `${s.matchesCount} مباراة`, s.toDate && `حتى ${fmtDate(s.toDate)}`, s.points && `−${s.points} نقطة`, Number(s.fineAmount) > 0 && money(s.fineAmount)].filter(Boolean).join(" — ")}</td>
                <td>{comp ?? "—"}</td><td><Badge v={SANCTION_STATUS[s.status]} /></td>
                <td><Link href={`/competitions/sanctions/${s.id}`}>فتح</Link></td>
              </tr>))}</tbody></table>
        )}
      </div>
    </>
  );
}
