import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { waOutbox } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { fmtDateTime } from "@/lib/util";
import { waAuto } from "@/lib/waoutbox";
import { PageHead, Empty } from "@/components/ui";

const ST: Record<string, [string, string]> = {
  PENDING: ["جاهزة — لم تُفتح", "b-amber"], DONE: ["فُتحت في واتساب", "b-green"], SENT: ["أُرسلت تلقائيًا", "b-green"],
  FAILED: ["فشل الإرسال", "b-red"], NO_PHONE: ["لا يوجد رقم", "b-red"], DISMISSED: ["أُخفيت", "b-gray"],
};

/** سجل رسائل واتساب التي نتجت عن أزرار التأكيد التي ضغطها المستخدم */
export default async function WaLog() {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  const rows = await db.select().from(waOutbox).where(eq(waOutbox.userId, u.id)).orderBy(desc(waOutbox.id)).limit(200);
  return (
    <>
      <PageHead title="سجل إشعارات واتساب" sub={waAuto() ? "الإرسال التلقائي عبر واتساب الرسمي مفعّل" : "الإرسال يدوي: الزر يفتح واتساب والرسالة جاهزة، ثم اضغط «إرسال»"} />
      <div className="card table-wrap">
        {rows.length === 0 ? <Empty>لا توجد رسائل بعد</Empty> : (
          <table className="t"><thead><tr><th>الوقت</th><th>إلى</th><th>الرسالة</th><th>الحالة</th><th></th></tr></thead>
            <tbody>{rows.map((w) => (
              <tr key={w.id}><td>{fmtDateTime(w.createdAt)}</td><td><strong>{w.toName}</strong><div className="kbd" style={{ fontSize: ".75rem" }}>{w.phone ?? "—"}</div></td>
                <td style={{ whiteSpace: "pre-wrap", fontSize: ".85rem", maxWidth: 420 }}>{w.body}</td>
                <td><span className={`b ${ST[w.status]?.[1]}`}>{ST[w.status]?.[0] ?? w.status}</span>{w.error && <div className="danger-text" style={{ fontSize: ".75rem" }}>{w.error}</div>}</td>
                <td>{w.phone && w.status !== "SENT" && <a className="btn btn-sm btn-light" href={`https://wa.me/${w.phone}?text=${encodeURIComponent(w.body)}`} target="_blank" rel="noopener noreferrer">📲 فتح</a>}</td></tr>))}</tbody></table>
        )}
      </div>
    </>
  );
}
