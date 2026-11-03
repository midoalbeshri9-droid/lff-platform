import { desc, inArray, and, ilike } from "drizzle-orm";
import { db } from "@/db";
import { users, auditLogs } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { divContext, divUsersWhere } from "@/lib/division";
import { fmtDateTime } from "@/lib/util";
import { PageHead, Empty, type SP } from "@/components/ui";
import { DivNav } from "../DivNav";

/** سجل عمليات الدرجة: كل ما فعله مستخدمو الدرجة (موظفوها وأنديتها وحكامها) */
export default async function DivisionAudit({ searchParams }: { searchParams: SP }) {
  const u = await requireUser("div.users");
  const sp = await searchParams;
  const d = await divContext(u, Number(sp.d) || null);
  if (!d) return (<><PageHead title="سجل عمليات الدرجة" sub="اختر الدرجة" /><DivNav u={u} d={null} active="audit" /></>);
  const ids = (await db.select({ id: users.id }).from(users).where(await divUsersWhere(d.id))).map((x) => x.id);
  const q = String(sp.q ?? "").trim();
  const rows = ids.length ? await db.select().from(auditLogs)
    .where(and(inArray(auditLogs.userId, ids), q ? ilike(auditLogs.action, `%${q}%`) : undefined)).orderBy(desc(auditLogs.at)).limit(400) : [];
  return (
    <>
      <PageHead title={`سجل عمليات ${d.name}`} sub="آخر 400 عملية لمستخدمي الدرجة" />
      <DivNav u={u} d={d} active="audit" />
      <form className="filters" method="get">
        {d.admin && <input type="hidden" name="d" value={d.id} />}
        <div className="field grow"><label>بحث في العملية</label><input type="search" name="q" defaultValue={q} placeholder="مثال: اعتماد، تسجيل دخول، إضافة" /></div>
        <button className="btn btn-light">بحث</button>
      </form>
      <div className="card table-wrap">
        {rows.length === 0 ? <Empty>لا عمليات</Empty> : (
          <table className="t"><thead><tr><th>الوقت</th><th>المستخدم</th><th>العملية</th><th>العنصر</th><th>التفاصيل</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}><td style={{ whiteSpace: "nowrap" }}>{fmtDateTime(r.at)}</td><td>{r.userName}</td><td>{r.action}</td>
                <td className="kbd">{r.entity}{r.entityId ? ` #${r.entityId}` : ""}</td>
                <td style={{ fontSize: ".8rem", maxWidth: 380, wordBreak: "break-word" }} className="muted">{r.details?.slice(0, 200)}</td></tr>
            ))}</tbody></table>
        )}
      </div>
    </>
  );
}
