import Link from "next/link";
import { and, eq, desc, ilike, or, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { registrations, players, seasons, ageCategories } from "@/db/schema";
import { requireClubUser } from "@/lib/auth";
import { getCurrentSeason } from "@/lib/registration";
import { REG_STATUS, REG_TYPE, POSITION } from "@/lib/labels";
import { fmtDate, today } from "@/lib/util";
import { fileUrl } from "@/lib/storage";
import { medicalMonths, medicalExpiry } from "@/lib/regchecks";
import { PageHead, Badge, Empty, type SP } from "@/components/ui";

export default async function ClubPlayers({ searchParams }: { searchParams: SP }) {
  const u = await requireClubUser("club.view");
  const sp = await searchParams;
  const cur = await getCurrentSeason();
  const allSeasons = await db.select().from(seasons).orderBy(desc(seasons.startDate));
  const seasonId = Number(sp.season ?? cur?.id ?? 0);
  const q = sp.q?.trim();
  const rows = await db
    .select({ r: registrations, p: players, cat: ageCategories.name })
    .from(registrations)
    .innerJoin(players, eq(players.id, registrations.playerId))
    .leftJoin(ageCategories, eq(ageCategories.id, registrations.categoryId))
    .where(and(
      eq(registrations.clubId, u.clubId), eq(registrations.seasonId, seasonId), eq(registrations.status, (sp.status as "APPROVED") ?? "APPROVED"),
      sp.medical ? isNotNull(players.medicalExamDate) : undefined,
      q ? or(ilike(players.fullName, `%${q}%`), ilike(players.nationalId, `%${q}%`), ilike(registrations.number, `%${q}%`)) : undefined,
    ))
    .orderBy(ageCategories.sortOrder, registrations.shirtNumber, players.fullName);
  const months = await medicalMonths();
  const t = today(), soon = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const shown = sp.medical ? rows.filter(({ p }) => { const e = medicalExpiry(p.medicalExamDate, months); return e && e <= soon; }) : rows;
  return (
    <>
      <PageHead title="لاعبو النادي" sub={sp.medical ? `${shown.length} لاعب كشفهم الطبي منتهٍ أو ينتهي خلال 30 يومًا` : `${rows.length} لاعب`} actions={u.can("club.edit") && <><Link className="btn btn-primary" href="/club/players/new?mode=new">➕ لاعب جديد</Link><Link className="btn btn-light" href="/club/renew">🔄 تجديد</Link><Link className="btn btn-light" href="/club/players/new?mode=transfer">⇄ انتقال / إعارة</Link></>} />
      <form className="filters card">
        <div className="field"><label>الموسم</label>
          <select name="season" defaultValue={String(seasonId)}>{allSeasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div className="field"><label>الحالة</label>
          <select name="status" defaultValue={sp.status ?? "APPROVED"}>{["APPROVED", "TRANSFERRED", "EXPIRED"].map((k) => <option key={k} value={k}>{REG_STATUS[k][0]}</option>)}</select></div>
        <div className="field grow"><label>بحث</label><input type="search" name="q" defaultValue={q} placeholder="الاسم أو الرقم الوطني أو رقم القيد" /></div>
        <button className="btn btn-light">عرض</button>
      </form>
      <div className="card table-wrap">
        {shown.length === 0 ? <Empty>لا يوجد لاعبون</Empty> : (
          <table className="t">
            <thead><tr><th></th><th>رقم القيد</th><th>الاسم</th><th>الميلاد</th><th>الفئة</th><th>المركز</th><th>رقم القميص</th><th>النوع</th><th>الحالة</th><th></th></tr></thead>
            <tbody>
              {shown.map(({ r, p, cat }) => (
                <tr key={r.id}>
                  <td>{p.photoKey ? <img className="thumb" src={fileUrl(p.photoKey)!} alt="" /> : <span className="ph">👤</span>}</td>
                  <td className="kbd">{r.number ?? "—"}</td>
                  <td><strong>{p.fullName}</strong>{p.isForeign && <span className="b b-purple" style={{ marginInlineStart: 6 }}>أجنبي</span>}
                    {(() => { const e = medicalExpiry(p.medicalExamDate, months); return e && e <= soon ? <span className={`b ${e < t ? "b-red" : "b-amber"}`} style={{ marginInlineStart: 6 }}>🩺 {e < t ? "كشف منتهٍ" : "كشف ينتهي " + e}</span> : null; })()}</td>
                  <td>{fmtDate(p.dateOfBirth)}</td>
                  <td>{cat ?? "—"}</td>
                  <td>{POSITION[p.position]}</td>
                  <td className="num">{r.shirtNumber ?? "—"}</td>
                  <td>{REG_TYPE[r.type]}</td>
                  <td><Badge v={REG_STATUS[r.status]} /></td>
                  <td><Link href={`/club/registrations/${r.id}`}>التفاصيل</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
