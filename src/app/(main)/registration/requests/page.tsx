import Link from "next/link";
import { and, eq, desc, ilike, or, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { registrations, players, clubs, seasons } from "@/db/schema";
import { scopeOf, clubIn, regIn, guardPage, inScopeReg, inScopePlayer } from "@/lib/scope";
import { requireUser } from "@/lib/auth";
import { getCurrentSeason } from "@/lib/registration";
import { REG_STATUS, REG_TYPE, ORIGIN } from "@/lib/labels";
import { fmtDateTime } from "@/lib/util";
import { PageHead, Badge, Empty, Options, type SP } from "@/components/ui";

export default async function Requests({ searchParams }: { searchParams: SP }) {
  const u = await requireUser("reg.view");
  const sc = await scopeOf(u);
  const sp = await searchParams;
  const cur = await getCurrentSeason();
  const allClubs = await db.select({ id: clubs.id, name: clubs.name }).from(clubs).where(clubIn(sc, clubs.id)).orderBy(clubs.name);
  const allSeasons = await db.select().from(seasons).orderBy(desc(seasons.startDate));
  const status = sp.status ?? "SUBMITTED";
  const seasonId = Number(sp.season ?? cur?.id ?? 0);
  const fc = alias(clubs, "fc");
  const where = and(
    regIn(sc),
    status === "ALL" ? undefined : status === "OPEN" ? inArray(registrations.status, ["SUBMITTED", "NEEDS_CORRECTION"]) : eq(registrations.status, status as "SUBMITTED"),
    seasonId ? eq(registrations.seasonId, seasonId) : undefined,
    sp.club ? eq(registrations.clubId, Number(sp.club)) : undefined,
    sp.type ? eq(registrations.type, sp.type as "NEW") : undefined,
    sp.q ? or(ilike(players.fullName, `%${sp.q}%`), ilike(players.nationalId, `%${sp.q}%`), ilike(registrations.number, `%${sp.q}%`)) : undefined,
  );
  const rows = await db
    .select({ r: registrations, name: players.fullName, nid: players.nationalId, club: clubs.name, from: fc.name,
      docs: sql<number>`(select count(*)::int from registration_documents d where d.registration_id = "registrations"."id" and d.status = 'PENDING')` })
    .from(registrations).innerJoin(players, eq(players.id, registrations.playerId)).innerJoin(clubs, eq(clubs.id, registrations.clubId))
    .leftJoin(fc, eq(fc.id, registrations.fromClubId))
    .where(where).orderBy(status === "SUBMITTED" ? registrations.submittedAt : desc(registrations.updatedAt)).limit(500);
  const tabs: [string, string][] = [["SUBMITTED", "قيد المراجعة"], ["NEEDS_CORRECTION", "مُعادة للأندية"], ["APPROVED", "معتمدة"], ["REJECTED", "مرفوضة"], ["DRAFT", "مسودات الأندية"], ["ALL", "الكل"]];
  const qs = (s: string) => `?status=${s}&season=${seasonId}${sp.club ? "&club=" + sp.club : ""}`;
  return (
    <>
      <PageHead title="طلبات القيد" sub="الطلبات المرسلة من الأندية للمراجعة والاعتماد" />
      <div className="tabs">{tabs.map(([k, l]) => <Link key={k} href={qs(k)} className={`tab ${status === k ? "active" : ""}`}>{l}</Link>)}</div>
      <form className="filters">
        <input type="hidden" name="status" value={status} />
        <div className="field"><label>الموسم</label><select name="season" defaultValue={String(seasonId)}>{allSeasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div className="field"><label>النادي</label><select name="club" defaultValue={sp.club ?? ""}><option value="">كل الأندية</option>{allClubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field"><label>النوع</label><select name="type" defaultValue={sp.type ?? ""}><option value="">الكل</option><Options map={REG_TYPE} /></select></div>
        <div className="field grow"><label>بحث</label><input type="search" name="q" defaultValue={sp.q} placeholder="الاسم، الرقم الوطني، رقم القيد" /></div>
        <button className="btn btn-light">تصفية</button>
      </form>
      <div className="card table-wrap">
        {rows.length === 0 ? <Empty>لا توجد طلبات</Empty> : (
          <table className="t">
            <thead><tr><th>رقم الطلب</th><th>اللاعب</th><th>النادي</th><th>النوع</th><th>النادي السابق</th><th>مستندات معلقة</th><th>أُرسل</th><th>الحالة</th><th></th></tr></thead>
            <tbody>{rows.map(({ r, name, nid, club, from, docs }) => (
              <tr key={r.id} className={r.possibleDuplicates ? "hl" : ""}>
                <td>{r.id}</td>
                <td><strong>{name}</strong><div className="muted kbd" style={{ fontSize: ".8rem" }}>{nid}</div>{r.possibleDuplicates && <span className="b b-amber">تشابه محتمل</span>}</td>
                <td>{club}</td><td>{REG_TYPE[r.type]}</td>
                <td>{from ? <>{from} <Badge v={ORIGIN[r.originResponse]} /></> : "—"}</td>
                <td className="num">{docs || "—"}</td>
                <td>{fmtDateTime(r.submittedAt)}</td>
                <td><Badge v={REG_STATUS[r.status]} /></td>
                <td><Link className="btn btn-sm btn-primary" href={`/registration/requests/${r.id}`}>{r.status === "SUBMITTED" ? "مراجعة" : "عرض"}</Link></td>
              </tr>))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
