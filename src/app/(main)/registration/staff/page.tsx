import { and, eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { staff, clubs, seasons } from "@/db/schema";
import { scopeOf, clubIn, regIn, guardPage, inScopeReg, inScopePlayer } from "@/lib/scope";
import { requireUser } from "@/lib/auth";
import { getCurrentSeason } from "@/lib/registration";
import Link from "next/link";
import { REG_STATUS, STAFF_ROLE, STAFF_GROUP, staffGroup, COACH_LEVEL } from "@/lib/labels";
import { fileUrl } from "@/lib/storage";
import { fmtDateTime } from "@/lib/util";
import { PageHead, Flash, Badge, Empty, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { setStaffCard } from "../actions";

export default async function StaffReview({ searchParams }: { searchParams: SP }) {
  const u = await requireUser("reg.view", "reg.staff");
  const sp = await searchParams;
  const cur = await getCurrentSeason();
  const ss = await db.select().from(seasons).orderBy(desc(seasons.startDate));
  const seasonId = Number(sp.season ?? cur?.id ?? 0);
  const status = (sp.status ?? "SUBMITTED") as "SUBMITTED";
  const rows = await db.select({ s: staff, club: clubs.name }).from(staff).innerJoin(clubs, eq(clubs.id, staff.clubId))
    .where(and(clubIn(await scopeOf(u), staff.clubId), eq(staff.seasonId, seasonId), sp.status === "ALL" ? undefined : eq(staff.status, status))).orderBy(clubs.name, staff.role);
  const list = sp.group ? rows.filter((x) => staffGroup(x.s.role) === sp.group) : rows;
  return (
    <>
      <PageHead title="قيد المدربين والإداريين" />
      <Flash sp={sp} />
      <form className="filters">
        <div className="field"><label>الموسم</label><select name="season" defaultValue={String(seasonId)}>{ss.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div className="field"><label>الحالة</label><select name="status" defaultValue={sp.status ?? "SUBMITTED"}>
          <option value="SUBMITTED">قيد المراجعة</option><option value="APPROVED">معتمد</option><option value="NEEDS_CORRECTION">مُعاد</option><option value="REJECTED">مرفوض</option><option value="ALL">الكل</option></select></div>
        <div className="field"><label>الدور</label><select name="group" defaultValue={sp.group ?? ""}><option value="">الكل</option><option value="COACH">{STAFF_GROUP.COACH.label}</option><option value="OFFICIAL">{STAFF_GROUP.OFFICIAL.label}</option></select></div>
        <button className="btn btn-light">عرض</button>
      </form>
      <div className="card table-wrap">
        {list.length === 0 ? <Empty>لا يوجد</Empty> : (
          <table className="t"><thead><tr><th></th><th>الاسم</th><th>النادي</th><th>الصفة</th><th>الرقم الوطني</th><th>الرخصة</th><th>رقم البطاقة</th><th>الحالة</th><th></th></tr></thead>
            <tbody>{list.map(({ s, club }) => (
              <tr key={s.id}>
                <td>{s.photoKey ? <img className="thumb" src={fileUrl(s.photoKey)!} alt="" /> : <span className="ph">👤</span>}</td>
                <td><strong>{s.fullName}</strong><div className="muted" style={{ fontSize: ".75rem" }}>{fmtDateTime(s.submittedAt)}</div></td>
                <td>{club}</td><td>{STAFF_ROLE[s.role]}<div className="muted" style={{ fontSize: ".75rem" }}>{STAFF_GROUP[staffGroup(s.role)].label}{s.level ? ` · ${COACH_LEVEL[s.level]}` : ""}</div></td><td className="kbd">{s.nationalId ?? "—"}</td><td>{s.licenseLevel ?? "—"}{s.licenseUntil && <div className="muted" style={{ fontSize: ".75rem" }}>حتى {s.licenseUntil}</div>}</td>
                <td>{u.can("reg.staff") ? (
                  <form action={setStaffCard} className="row" style={{ flexWrap: "nowrap" }}>
                    <input type="hidden" name="id" value={s.id} /><input type="hidden" name="back" value={`/registration/staff?season=${seasonId}&status=${sp.status ?? "SUBMITTED"}`} />
                    <input type="text" name="cardNo" defaultValue={s.cardNo ?? ""} style={{ width: 90 }} dir="ltr" />
                    <Submit className="btn btn-sm btn-ghost">💾</Submit>
                  </form>) : (s.cardNo ?? "—")}</td>
                <td><Badge v={REG_STATUS[s.status]} /></td>
                <td><Link className="btn btn-sm btn-light" href={`/registration/staff/${s.id}`}>{s.status === "SUBMITTED" ? "مراجعة" : "عرض"}</Link></td>
              </tr>))}</tbody></table>
        )}
      </div>
    </>
  );
}
