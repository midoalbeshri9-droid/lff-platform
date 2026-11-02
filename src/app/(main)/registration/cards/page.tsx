import Link from "next/link";
import { and, eq, desc, ilike, or, inArray } from "drizzle-orm";
import { db } from "@/db";
import { registrations, players, clubs, seasons, ageCategories, cardTemplates } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getCurrentSeason } from "@/lib/registration";
import { fmtDateTime } from "@/lib/util";
import { fileUrl } from "@/lib/storage";
import { PageHead, Empty, type SP } from "@/components/ui";
import { CheckAll } from "@/components/Client";

export default async function CardsQueue({ searchParams }: { searchParams: SP }) {
  const u = await requireUser("cards.print");
  const sp = await searchParams;
  const cur = await getCurrentSeason();
  const seasonId = Number(sp.season ?? cur?.id ?? 0);
  const only = sp.printed ?? "no";
  const ids = (sp.ids ?? "").split(",").map(Number).filter(Boolean);
  const [ss, cl, cats, tpls] = await Promise.all([
    db.select().from(seasons).orderBy(desc(seasons.startDate)),
    db.select({ id: clubs.id, name: clubs.name }).from(clubs).orderBy(clubs.name),
    db.select().from(ageCategories).orderBy(ageCategories.sortOrder),
    db.select().from(cardTemplates).orderBy(desc(cardTemplates.isDefault), cardTemplates.name),
  ]);
  const rows = await db
    .select({ r: registrations, p: players, club: clubs.name, cat: ageCategories.name })
    .from(registrations).innerJoin(players, eq(players.id, registrations.playerId)).innerJoin(clubs, eq(clubs.id, registrations.clubId))
    .leftJoin(ageCategories, eq(ageCategories.id, registrations.categoryId))
    .where(ids.length ? inArray(registrations.id, ids) : and(
      eq(registrations.seasonId, seasonId), eq(registrations.status, "APPROVED"),
      sp.club ? eq(registrations.clubId, Number(sp.club)) : undefined,
      sp.category ? eq(registrations.categoryId, Number(sp.category)) : undefined,
      only === "no" ? eq(registrations.cardPrintCount, 0) : only === "yes" ? undefined : undefined,
      sp.q ? or(ilike(players.fullName, `%${sp.q}%`), ilike(registrations.number, `%${sp.q}%`)) : undefined,
    ))
    .orderBy(clubs.name, ageCategories.sortOrder, players.fullName).limit(500);
  return (
    <>
      <PageHead title="طباعة بطاقات اللاعبين" sub="اختر اللاعبين المعتمدين والقالب ثم اطبع على Fargo DTC1250e"
        actions={u.can("cards.design") && <Link className="btn btn-light" href="/registration/cards/templates">🎨 قوالب البطاقات</Link>} />
      <form className="filters">
        <div className="field"><label>الموسم</label><select name="season" defaultValue={String(seasonId)}>{ss.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div className="field"><label>النادي</label><select name="club" defaultValue={sp.club ?? ""}><option value="">كل الأندية</option>{cl.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field"><label>الفئة</label><select name="category" defaultValue={sp.category ?? ""}><option value="">الكل</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field"><label>الطباعة</label><select name="printed" defaultValue={only}><option value="no">لم تُطبع بطاقاتهم</option><option value="all">الكل</option></select></div>
        <div className="field grow"><label>بحث</label><input type="search" name="q" defaultValue={sp.q} /></div>
        <button className="btn btn-light">عرض</button>
      </form>
      {tpls.length === 0 && <div className="alert warn">لا يوجد قالب بطاقة — <Link href="/registration/cards/templates/new">صمّم قالبًا أولًا</Link></div>}
      <form action="/print/cards" target="_blank" className="card">
        <div className="row" style={{ marginBottom: ".8rem" }}>
          <div className="field"><label>القالب</label><select name="template">{tpls.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isDefault ? " (افتراضي)" : ""}</option>)}</select></div>
          <div className="field"><label>الوجه</label><select name="side"><option value="front">الأمامي فقط</option><option value="both">الوجهان (أمامي ثم خلفي)</option><option value="back">الخلفي فقط</option></select></div>
          <label className="check"><input type="checkbox" name="replacement" value="1" /> بطاقة بديلة (فقدان/تلف)</label>
          <span className="spacer" />
          <button className="btn btn-gold" disabled={!tpls.length}>🖨 معاينة وطباعة المحدد</button>
        </div>
        {rows.length === 0 ? <Empty>لا يوجد لاعبون بهذه المعايير</Empty> : (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th><CheckAll name="id" label="" /></th><th></th><th>رقم القيد</th><th>اللاعب</th><th>النادي</th><th>الفئة</th><th>طُبعت</th><th>آخر طباعة</th></tr></thead>
              <tbody>{rows.map(({ r, p, club, cat }) => (
                <tr key={r.id}>
                  <td><input type="checkbox" name="id" value={r.id} defaultChecked={ids.includes(r.id)} disabled={r.status !== "APPROVED"} /></td>
                  <td>{p.photoKey ? <img className="thumb" src={fileUrl(p.photoKey)!} alt="" /> : <span className="ph" title="لا توجد صورة">⚠</span>}</td>
                  <td className="kbd">{r.number}</td><td><strong>{p.fullName}</strong></td><td>{club}</td><td>{cat}</td>
                  <td className="num">{r.cardPrintCount || "—"}</td><td>{fmtDateTime(r.lastCardPrintedAt)}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </form>
    </>
  );
}
