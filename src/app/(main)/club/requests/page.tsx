import Link from "next/link";
import { and, eq, desc, inArray } from "drizzle-orm";
import { db } from "@/db";
import { registrations, players, clubs } from "@/db/schema";
import { requireClubUser } from "@/lib/auth";
import { REG_STATUS, REG_TYPE, ORIGIN } from "@/lib/labels";
import { fmtDateTime } from "@/lib/util";
import { PageHead, Badge, Empty, type SP } from "@/components/ui";

const OPEN = ["DRAFT", "SUBMITTED", "NEEDS_CORRECTION", "REJECTED", "CANCELLED"] as const;
/** أقسام الطلبات: كل نوع في قائمته الخاصة */
const KINDS = {
  new: { title: "طلبات التسجيل الجديد", types: ["NEW"], add: ["/club/players/new?mode=new", "+ تسجيل لاعب جديد"] },
  renew: { title: "طلبات التجديد", types: ["RENEWAL"], add: ["/club/renew", "🔄 تجديد قيد لاعبين"] },
  transfer: { title: "طلبات الانتقال والإعارة الواردة", types: ["TRANSFER", "LOAN", "LOAN_RETURN"], add: ["/club/players/new?mode=transfer", "⇄ ضم لاعب من نادٍ آخر"] },
} as const;

export default async function ClubRequests({ searchParams }: { searchParams: SP }) {
  const u = await requireClubUser("club.view");
  const sp = await searchParams;
  const st = sp.status && (OPEN as readonly string[]).includes(sp.status) ? [sp.status as (typeof OPEN)[number]] : ["DRAFT", "SUBMITTED", "NEEDS_CORRECTION"] as (typeof OPEN)[number][];
  const kind = sp.kind && sp.kind in KINDS ? KINDS[sp.kind as keyof typeof KINDS] : null;
  const rows = await db
    .select({ r: registrations, name: players.fullName, from: clubs.name })
    .from(registrations).innerJoin(players, eq(players.id, registrations.playerId)).leftJoin(clubs, eq(clubs.id, registrations.fromClubId))
    .where(and(eq(registrations.clubId, u.clubId), inArray(registrations.status, st), kind ? inArray(registrations.type, [...kind.types]) : undefined))
    .orderBy(desc(registrations.updatedAt)).limit(300);
  const k = sp.kind ? `kind=${sp.kind}&` : "";
  return (
    <>
      <PageHead title={kind?.title ?? "كل طلبات القيد"} actions={u.can("club.edit") && (kind
        ? <Link className="btn btn-primary" href={kind.add[0]}>{kind.add[1]}</Link>
        : <><Link className="btn btn-light" href="/club/players/new?mode=new">+ لاعب جديد</Link><Link className="btn btn-light" href="/club/renew">🔄 تجديد</Link><Link className="btn btn-light" href="/club/players/new?mode=transfer">⇄ انتقال / إعارة</Link></>)} />
      <div className="tabs" style={{ marginBottom: ".4rem" }}>
        <Link className={`tab ${!sp.kind ? "active" : ""}`} href={`/club/requests${sp.status ? "?status=" + sp.status : ""}`}>الكل</Link>
        {Object.entries(KINDS).map(([key, v]) => <Link key={key} className={`tab ${sp.kind === key ? "active" : ""}`} href={`/club/requests?kind=${key}${sp.status ? "&status=" + sp.status : ""}`}>{v.title.replace("طلبات ", "")}</Link>)}
      </div>
      <div className="tabs">
        <Link className={`tab ${!sp.status ? "active" : ""}`} href={`/club/requests${k ? "?" + k.slice(0, -1) : ""}`}>المفتوحة</Link>
        {OPEN.map((s) => <Link key={s} className={`tab ${sp.status === s ? "active" : ""}`} href={`/club/requests?${k}status=${s}`}>{REG_STATUS[s][0]}</Link>)}
      </div>
      <div className="card table-wrap">
        {rows.length === 0 ? <Empty>لا توجد طلبات</Empty> : (
          <table className="t">
            <thead><tr><th>رقم الطلب</th><th>اللاعب</th><th>النوع</th><th>الحالة</th><th>النادي السابق</th><th>آخر تحديث</th><th></th></tr></thead>
            <tbody>{rows.map(({ r, name, from }) => (
              <tr key={r.id} className={r.status === "NEEDS_CORRECTION" ? "hl" : ""}>
                <td>{r.id}</td><td><strong>{name}</strong>{r.decisionReason && r.status !== "APPROVED" && <div className="danger-text" style={{ fontSize: ".82rem" }}>{r.decisionReason}</div>}</td>
                <td>{REG_TYPE[r.type]}</td><td><Badge v={REG_STATUS[r.status]} /></td>
                <td>{from ? <>{from}{r.originResponse !== "NOT_REQUIRED" && <> <Badge v={ORIGIN[r.originResponse]} /></>}</> : "—"}</td>
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
