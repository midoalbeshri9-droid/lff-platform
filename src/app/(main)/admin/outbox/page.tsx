import { desc, eq, and } from "drizzle-orm";
import { db } from "@/db";
import { outbox } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { mailConfigured } from "@/lib/mail";
import { fmtDateTime } from "@/lib/util";
import { PageHead, Empty, type SP } from "@/components/ui";

const ST: Record<string, [string, string]> = { SENT: ["أُرسلت", "b-green"], FAILED: ["فشل الإرسال", "b-red"], NOT_CONFIGURED: ["لم تُرسل (البريد غير مُعدّ)", "b-amber"], PENDING: ["قيد الإرسال", "b-gray"] };

export default async function Outbox({ searchParams }: { searchParams: SP }) {
  await requireUser("admin.outbox");
  const sp = await searchParams;
  const rows = await db.select().from(outbox).where(and(sp.status ? eq(outbox.status, sp.status) : undefined)).orderBy(desc(outbox.id)).limit(300);
  return (
    <>
      <PageHead title="صندوق الرسائل الصادرة" sub="رسائل التفعيل واستعادة كلمة المرور والإشعارات — البريد وSMS" />
      {!(await mailConfigured()) ? (
        <div className="alert warn">
          البريد غير مُعدّ بعد، لذلك لا تُرسل الرسائل تلقائيًا. انسخ رابط التفعيل من الجدول وأرسله للمستخدم (واتساب مثلًا).
          لتفعيل الإرسال اضبط Gmail من <a href="/admin/mail"><strong>إعدادات البريد</strong></a>.
        </div>
      ) : <div className="alert ok">البريد مُعدّ — الرسائل تُرسل تلقائيًا. <a href="/admin/mail">إعدادات البريد</a></div>}
      <form className="filters">
        <div className="field"><label>الحالة</label><select name="status" defaultValue={sp.status ?? ""}><option value="">الكل</option>{Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v[0]}</option>)}</select></div>
        <button className="btn btn-light">عرض</button>
      </form>
      <div className="card table-wrap">
        {rows.length === 0 ? <Empty>لا توجد رسائل</Empty> : (
          <table className="t"><thead><tr><th>الوقت</th><th>القناة</th><th>إلى</th><th>الموضوع</th><th>الرابط</th><th>الحالة</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}><td className="nowrap">{fmtDateTime(r.createdAt)}</td><td>{r.channel === "SMS" ? "SMS" : "بريد"}</td><td className="kbd">{r.to}</td>
                <td>{r.subject ?? r.body.slice(0, 60)}</td>
                <td>{r.link ? <input readOnly value={r.link} dir="ltr" style={{ fontSize: ".75rem", minWidth: 260 }} /> : "—"}</td>
                <td><span className={`b ${ST[r.status]?.[1]}`}>{ST[r.status]?.[0] ?? r.status}</span>{r.error && <div className="danger-text" style={{ fontSize: ".75rem" }}>{r.error}</div>}</td></tr>
            ))}</tbody></table>
        )}
      </div>
    </>
  );
}
