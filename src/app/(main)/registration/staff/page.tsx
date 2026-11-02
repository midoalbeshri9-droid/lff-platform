import { and, eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { staff, clubs, seasons } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getCurrentSeason } from "@/lib/registration";
import { REG_STATUS, STAFF_ROLE } from "@/lib/labels";
import { fileUrl } from "@/lib/storage";
import { fmtDateTime } from "@/lib/util";
import { PageHead, Flash, Badge, Empty, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { decideStaff } from "../actions";

export default async function StaffReview({ searchParams }: { searchParams: SP }) {
  const u = await requireUser("reg.view", "reg.staff");
  const sp = await searchParams;
  const cur = await getCurrentSeason();
  const ss = await db.select().from(seasons).orderBy(desc(seasons.startDate));
  const seasonId = Number(sp.season ?? cur?.id ?? 0);
  const status = (sp.status ?? "SUBMITTED") as "SUBMITTED";
  const rows = await db.select({ s: staff, club: clubs.name }).from(staff).innerJoin(clubs, eq(clubs.id, staff.clubId))
    .where(and(eq(staff.seasonId, seasonId), sp.status === "ALL" ? undefined : eq(staff.status, status))).orderBy(clubs.name, staff.role);
  return (
    <>
      <PageHead title="قيد الإداريين والجهاز الفني" />
      <Flash sp={sp} />
      <form className="filters">
        <div className="field"><label>الموسم</label><select name="season" defaultValue={String(seasonId)}>{ss.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div className="field"><label>الحالة</label><select name="status" defaultValue={sp.status ?? "SUBMITTED"}>
          <option value="SUBMITTED">قيد المراجعة</option><option value="APPROVED">معتمد</option><option value="NEEDS_CORRECTION">مُعاد</option><option value="REJECTED">مرفوض</option><option value="ALL">الكل</option></select></div>
        <button className="btn btn-light">عرض</button>
      </form>
      <div className="card table-wrap">
        {rows.length === 0 ? <Empty>لا يوجد</Empty> : (
          <table className="t"><thead><tr><th></th><th>الاسم</th><th>النادي</th><th>الصفة</th><th>الرقم الوطني</th><th>الرخصة</th><th>المستند</th><th>الحالة</th><th></th></tr></thead>
            <tbody>{rows.map(({ s, club }) => (
              <tr key={s.id}>
                <td>{s.photoKey ? <img className="thumb" src={fileUrl(s.photoKey)!} alt="" /> : <span className="ph">👤</span>}</td>
                <td><strong>{s.fullName}</strong><div className="muted" style={{ fontSize: ".75rem" }}>{fmtDateTime(s.submittedAt)}</div></td>
                <td>{club}</td><td>{STAFF_ROLE[s.role]}</td><td className="kbd">{s.nationalId ?? "—"}</td><td>{s.licenseNo ?? "—"} {s.licenseLevel}</td>
                <td>{s.documentKey ? <a href={fileUrl(s.documentKey)!} target="_blank">📎 عرض</a> : "—"}</td>
                <td><Badge v={REG_STATUS[s.status]} /></td>
                <td>{s.status === "SUBMITTED" && u.can("reg.staff") && (
                  <form action={decideStaff} className="row">
                    <input type="hidden" name="id" value={s.id} />
                    <input type="text" name="reason" placeholder="السبب (للرفض/الإعادة)" style={{ width: 160 }} />
                    <Submit name="decision" value="approve" className="btn btn-sm btn-primary">اعتماد</Submit>
                    <Submit name="decision" value="return" className="btn btn-sm btn-gold">إعادة</Submit>
                    <Submit name="decision" value="reject" className="btn btn-sm btn-danger">رفض</Submit>
                  </form>)}</td>
              </tr>))}</tbody></table>
        )}
      </div>
    </>
  );
}
