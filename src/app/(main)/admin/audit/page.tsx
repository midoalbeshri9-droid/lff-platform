import { and, desc, ilike, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { fmtDateTime } from "@/lib/util";
import { PageHead, type SP } from "@/components/ui";

export default async function Audit({ searchParams }: { searchParams: SP }) {
  await requireUser("admin.audit");
  const sp = await searchParams;
  const rows = await db.select().from(auditLogs)
    .where(and(sp.entity ? eq(auditLogs.entity, sp.entity) : undefined, sp.id ? eq(auditLogs.entityId, sp.id) : undefined,
      sp.q ? or(ilike(auditLogs.userName, `%${sp.q}%`), ilike(auditLogs.action, `%${sp.q}%`), ilike(auditLogs.details, `%${sp.q}%`)) : undefined))
    .orderBy(desc(auditLogs.at)).limit(500);
  return (
    <>
      <PageHead title="سجل العمليات" sub="كل إضافة وتعديل واعتماد في المنظومة مع اسم المستخدم والوقت" />
      <form className="filters">
        <div className="field"><label>الكيان</label><select name="entity" defaultValue={sp.entity ?? ""}><option value="">الكل</option>{["Registration", "Player", "Suspension", "Match", "Competition", "Official", "User", "Club", "RolePermission", "CardPrint"].map((e) => <option key={e}>{e}</option>)}</select></div>
        <div className="field"><label>الرقم</label><input type="text" name="id" defaultValue={sp.id} style={{ width: 90 }} /></div>
        <div className="field grow"><label>بحث</label><input type="search" name="q" defaultValue={sp.q} /></div>
        <button className="btn btn-light">بحث</button>
      </form>
      <div className="card table-wrap">
        <table className="t"><thead><tr><th>الوقت</th><th>المستخدم</th><th>العملية</th><th>الكيان</th><th>التفاصيل</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td className="nowrap">{fmtDateTime(r.at)}</td><td>{r.userName}</td><td>{r.action}</td><td className="kbd">{r.entity}{r.entityId ? ` #${r.entityId}` : ""}</td>
              <td className="muted" style={{ fontSize: ".8rem", maxWidth: 420, overflowWrap: "anywhere" }}>{r.details}</td></tr>
          ))}</tbody></table>
      </div>
    </>
  );
}
