import Link from "next/link";
import { and, eq, desc, inArray } from "drizzle-orm";
import { db } from "@/db";
import { registrations, players } from "@/db/schema";
import { requireClubUser } from "@/lib/auth";
import { REG_STATUS, REG_TYPE, ORIGIN } from "@/lib/labels";
import { fmtDateTime } from "@/lib/util";
import { PageHead, Badge, Empty, type SP } from "@/components/ui";

const OPEN = ["DRAFT", "SUBMITTED", "NEEDS_CORRECTION", "REJECTED", "CANCELLED"] as const;

export default async function ClubRequests({ searchParams }: { searchParams: SP }) {
  const u = await requireClubUser("club.view");
  const sp = await searchParams;
  const st = sp.status && (OPEN as readonly string[]).includes(sp.status) ? [sp.status as (typeof OPEN)[number]] : ["DRAFT", "SUBMITTED", "NEEDS_CORRECTION"] as (typeof OPEN)[number][];
  const rows = await db
    .select({ r: registrations, name: players.fullName })
    .from(registrations).innerJoin(players, eq(players.id, registrations.playerId))
    .where(and(eq(registrations.clubId, u.clubId), inArray(registrations.status, st)))
    .orderBy(desc(registrations.updatedAt)).limit(300);
  return (
    <>
      <PageHead title="طلبات القيد" actions={u.can("club.edit") && <Link className="btn btn-primary" href="/club/players/new">+ طلب جديد</Link>} />
      <div className="tabs">
        <Link className={`tab ${!sp.status ? "active" : ""}`} href="/club/requests">المفتوحة</Link>
        {OPEN.map((s) => <Link key={s} className={`tab ${sp.status === s ? "active" : ""}`} href={`/club/requests?status=${s}`}>{REG_STATUS[s][0]}</Link>)}
      </div>
      <div className="card table-wrap">
        {rows.length === 0 ? <Empty>لا توجد طلبات</Empty> : (
          <table className="t">
            <thead><tr><th>#</th><th>اللاعب</th><th>النوع</th><th>الحالة</th><th>النادي السابق</th><th>آخر تحديث</th><th></th></tr></thead>
            <tbody>{rows.map(({ r, name }) => (
              <tr key={r.id} className={r.status === "NEEDS_CORRECTION" ? "hl" : ""}>
                <td>{r.id}</td><td><strong>{name}</strong>{r.decisionReason && r.status !== "APPROVED" && <div className="danger-text" style={{ fontSize: ".82rem" }}>{r.decisionReason}</div>}</td>
                <td>{REG_TYPE[r.type]}</td><td><Badge v={REG_STATUS[r.status]} /></td>
                <td>{r.originResponse !== "NOT_REQUIRED" ? <Badge v={ORIGIN[r.originResponse]} /> : "—"}</td>
                <td>{fmtDateTime(r.updatedAt)}</td>
                <td><Link className="btn btn-sm btn-light" href={`/club/registrations/${r.id}`}>{["DRAFT", "NEEDS_CORRECTION"].includes(r.status) ? "استكمال" : "عرض"}</Link></td>
              </tr>))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
