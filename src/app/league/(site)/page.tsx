import Link from "next/link";
import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { competitions, seasons } from "@/db/schema";

export const metadata = { title: "المسابقات" };
export const dynamic = "force-dynamic";

export default async function LeagueHome() {
  const rows = await db.select({ c: competitions, season: seasons.name }).from(competitions).innerJoin(seasons, eq(seasons.id, competitions.seasonId))
    .where(and(eq(competitions.isPublic, true), ne(competitions.status, "DRAFT"))).orderBy(desc(competitions.seasonId), competitions.name);
  return (
    <>
      <h1 className="lg-h1">المسابقات</h1>
      {rows.length === 0 ? <p className="muted">لا توجد مسابقات منشورة حاليًا.</p> : (
        <div className="lg-grid">{rows.map(({ c, season }) => (
          <Link key={c.id} href={`/league/${c.id}`} className="lg-card">
            <div className="lg-card-t">{c.name}</div>
            <div className="muted">الموسم {season} — {c.status === "FINISHED" ? "منتهية" : "جارية"}</div>
          </Link>))}</div>
      )}
    </>
  );
}
