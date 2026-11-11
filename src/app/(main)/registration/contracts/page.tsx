import Link from "next/link";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { db } from "@/db";
import { contracts, players, clubs } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { scopeOf, clubIn } from "@/lib/scope";
import { expireContracts } from "@/lib/contracts";
import { CONTRACT_STATUS } from "@/lib/labels";
import { fmtDate, fmtDateTime, money } from "@/lib/util";
import { PageHead, Badge, Empty, type SP } from "@/components/ui";

export default async function RegContracts({ searchParams }: { searchParams: SP }) {
  const u = await requireUser("reg.contracts");
  const sc = await scopeOf(u);
  const sp = await searchParams;
  await expireContracts();
  const st = sp.status ?? "SUBMITTED";
  const q = sp.q?.trim();
  const clubList = await db.select({ id: clubs.id, name: clubs.name }).from(clubs).where(clubIn(sc, clubs.id)).orderBy(clubs.name);
  const rows = await db.select({ c: contracts, name: players.fullName, club: clubs.name }).from(contracts)
    .innerJoin(players, eq(players.id, contracts.playerId)).innerJoin(clubs, eq(clubs.id, contracts.clubId))
    .where(and(clubIn(sc, contracts.clubId), st === "ALL" ? undefined : eq(contracts.status, st as "SUBMITTED"),
      sp.club ? eq(contracts.clubId, Number(sp.club)) : undefined,
      q ? or(ilike(players.fullName, `%${q}%`), ilike(contracts.number, `%${q}%`)) : undefined))
    .orderBy(desc(contracts.submittedAt), desc(contracts.id)).limit(500);
  return (
    <>
      <PageHead title="عقود اللاعبين المحترفين" sub="العقود التي تكتبها الأندية إلكترونيًا وترفع نسختها الموقّعة للاعتماد" />
      <form className="filters card">
        <div className="field"><label>الحالة</label>
          <select name="status" defaultValue={st}><option value="ALL">الكل</option>{Object.entries(CONTRACT_STATUS).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</select></div>
        <div className="field"><label>النادي</label>
          <select name="club" defaultValue={sp.club ?? ""}><option value="">كل الأندية</option>{clubList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field grow"><label>بحث</label><input type="search" name="q" defaultValue={q} placeholder="اسم اللاعب أو رقم العقد" /></div>
        <button className="btn btn-light">عرض</button>
      </form>
      <div className="card table-wrap">
        {rows.length === 0 ? <Empty>لا توجد عقود بهذه الحالة.</Empty> : (
          <table className="t"><thead><tr><th>اللاعب</th><th>النادي</th><th>رقم العقد</th><th>المدة</th><th className="num">القيمة</th><th>أُرسل</th><th>الحالة</th><th></th></tr></thead>
            <tbody>{rows.map(({ c, name, club }) => (
              <tr key={c.id}><td><strong>{name}</strong></td><td>{club}</td><td className="kbd">{c.number ?? "—"}</td>
                <td>{fmtDate(c.startDate)} ← {fmtDate(c.endDate)}</td>
                <td className="num">{c.totalValue ? (c.currency === "LYD" ? money(c.totalValue) : `${Number(c.totalValue).toLocaleString("en-US")} ${c.currency}`) : "—"}</td>
                <td>{c.submittedAt ? fmtDateTime(c.submittedAt) : "—"}</td>
                <td><Badge v={CONTRACT_STATUS[c.status]} /></td>
                <td><Link className="btn btn-sm btn-light" href={`/registration/contracts/${c.id}`}>{c.status === "SUBMITTED" ? "مراجعة" : "عرض"}</Link></td></tr>))}</tbody></table>
        )}
      </div>
    </>
  );
}
