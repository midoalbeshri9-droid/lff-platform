import Link from "next/link";
import { and, eq, ilike, or, desc, sql, inArray } from "drizzle-orm";
import { db } from "@/db";
import { players, registrations, clubs } from "@/db/schema";
import { scopeOf, clubIn, regIn, guardPage, inScopeReg, inScopePlayer } from "@/lib/scope";
import { requireUser } from "@/lib/auth";
import { PLAYER_STATUS, POSITION } from "@/lib/labels";
import { fmtDate } from "@/lib/util";
import { fileUrl } from "@/lib/storage";
import { PageHead, Badge, Empty, type SP } from "@/components/ui";

export default async function PlayersList({ searchParams }: { searchParams: SP }) {
  const u = await requireUser("reg.view");
  const sc = await scopeOf(u);
  const sp = await searchParams;
  const q = sp.q?.trim();
  const allClubs = await db.select({ id: clubs.id, name: clubs.name }).from(clubs).where(clubIn(sc, clubs.id)).orderBy(clubs.name);
  const rows = await db
    .select({
      p: players,
      club: sql<string | null>`(select c.name from registrations r join clubs c on c.id = r.club_id where r.player_id = "players"."id" and r.status = 'APPROVED' order by r.id desc limit 1)`,
    })
    .from(players)
    .where(and(
      sc ? or(inArray(players.id, db.select({ id: registrations.playerId }).from(registrations).where(regIn(sc))), clubIn(sc, players.createdByClubId)) : undefined,
      q ? or(ilike(players.fullName, `%${q}%`), ilike(players.nationalId, `%${q}%`), ilike(players.cardNo, `%${q}%`), ilike(players.passportNo, `%${q}%`), ilike(players.fullNameEn, `%${q}%`)) : undefined,
      sp.status ? eq(players.status, sp.status as "ACTIVE") : undefined,
      sp.foreign === "1" ? eq(players.isForeign, true) : undefined,
      sp.club ? sql`exists (select 1 from ${registrations} r where r.player_id = "players"."id" and r.club_id = ${Number(sp.club)} and r.status = 'APPROVED')` : undefined,
    ))
    .orderBy(desc(players.id)).limit(300);
  return (
    <>
      <PageHead title="سجل اللاعبين" sub="كل اللاعبين المسجلين في المنظومة عبر كل الأندية والمواسم"
        actions={u.can("reg.edit") ? <Link className="btn btn-light" href="/registration/photos">🖼 استيراد الصور من Excel</Link> : undefined} />
      <form className="filters">
        <div className="field grow"><label>بحث</label><input type="search" name="q" defaultValue={q} placeholder="الاسم، رقم البطاقة، الرقم الوطني، الجواز" /></div>
        <div className="field"><label>النادي الحالي</label><select name="club" defaultValue={sp.club ?? ""}><option value="">الكل</option>{allClubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field"><label>الحالة</label><select name="status" defaultValue={sp.status ?? ""}><option value="">الكل</option>{Object.entries(PLAYER_STATUS).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</select></div>
        <label className="check"><input type="checkbox" name="foreign" value="1" defaultChecked={sp.foreign === "1"} /> الأجانب فقط</label>
        <button className="btn btn-light">بحث</button>
      </form>
      <div className="card table-wrap">
        {rows.length === 0 ? <Empty>لا نتائج</Empty> : (
          <table className="t">
            <thead><tr><th></th><th>الاسم</th><th>رقم البطاقة / الوطني</th><th>الميلاد</th><th>المركز</th><th>النادي (قيد ساري)</th><th>الحالة</th><th></th></tr></thead>
            <tbody>{rows.map(({ p, club }) => (
              <tr key={p.id}>
                <td>{p.photoKey ? <img className="thumb" src={fileUrl(p.photoKey)!} alt="" /> : <span className="ph">👤</span>}</td>
                <td><strong>{p.fullName}</strong>{p.isForeign && <span className="b b-purple" style={{ marginInlineStart: 6 }}>أجنبي</span>}</td>
                <td className="kbd">{p.cardNo ?? p.nationalId ?? p.passportNo ?? "—"}</td><td>{fmtDate(p.dateOfBirth)}</td><td>{POSITION[p.position]}</td>
                <td>{club ?? <span className="muted">—</span>}</td><td><Badge v={PLAYER_STATUS[p.status]} /></td>
                <td><Link href={`/registration/players/${p.id}`}>الملف</Link></td>
              </tr>))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
