import type { selfApplications } from "@/db/schema";
import { POSITION, OFFICIAL_TYPE, SELF_APP_STATUS } from "@/lib/labels";
import { fileUrl } from "@/lib/storage";
import { fmtDate, fmtDateTime } from "@/lib/util";
import { Badge, Empty } from "@/components/ui";
import { Submit } from "@/components/Client";

type App = typeof selfApplications.$inferSelect;

/** قائمة طلبات التسجيل الذاتي مع أزرار القبول/الرفض (للنادي أو لجنة الحكام) */
export function SelfAppsList({ rows, accept, reject, can, extra }: {
  rows: (App & { clubName?: string | null })[]; can: boolean;
  accept: (f: FormData) => Promise<void>; reject: (f: FormData) => Promise<void>; extra?: (a: App) => React.ReactNode;
}) {
  if (!rows.length) return <Empty>لا توجد طلبات</Empty>;
  return (
    <table className="t">
      <thead><tr><th>الصورة</th><th>مقدّم الطلب</th><th>البيانات</th><th>الحالة</th>{can && <th>القرار</th>}</tr></thead>
      <tbody>{rows.map((a) => (
        <tr key={a.id}>
          <td>{a.photoKey ? <a href={fileUrl(a.photoKey)!} target="_blank"><img src={fileUrl(a.photoKey)!} alt="" style={{ width: 56, height: 70, objectFit: "cover", borderRadius: 6 }} /></a> : "—"}</td>
          <td><strong>{a.fullName}</strong>{a.fullNameEn && <div dir="ltr" className="muted" style={{ fontSize: ".78rem" }}>{a.fullNameEn}</div>}
            <div className="muted" style={{ fontSize: ".75rem" }}>{a.refNo} — {fmtDateTime(a.createdAt)}</div></td>
          <td style={{ fontSize: ".85rem" }}>
            مواليد {fmtDate(a.dateOfBirth)}{a.placeOfBirth ? ` — ${a.placeOfBirth}` : ""} · {a.nationality}<br />
            {a.nationalId ? <>رقم وطني <span dir="ltr">{a.nationalId}</span></> : <>جواز <span dir="ltr">{a.passportNo}</span></>} · <span dir="ltr">{a.phone}</span>{a.email && <> · <span dir="ltr">{a.email}</span></>}<br />
            {a.kind === "PLAYER" ? <>المركز: {POSITION[a.position ?? "UNKNOWN"]}</> : <>الصفة: {OFFICIAL_TYPE[a.officialType ?? ""]}</>}{a.city && ` · ${a.city}`}
            {a.experience && <div className="muted">{a.experience}</div>}
            {a.idDocKey && <div><a href={fileUrl(a.idDocKey)!} target="_blank">📎 إثبات الهوية</a></div>}
            {extra?.(a)}
          </td>
          <td><Badge v={SELF_APP_STATUS[a.status]} />{a.reviewNote && <div className="muted" style={{ fontSize: ".75rem" }}>{a.reviewNote}</div>}{a.handledBy && <div className="muted" style={{ fontSize: ".72rem" }}>{a.handledBy}</div>}</td>
          {can && <td>{a.status === "NEW" && <div style={{ display: "grid", gap: 4 }}>
            <form action={accept}><input type="hidden" name="id" value={a.id} /><Submit className="btn btn-sm btn-primary">✓ قبول وإنشاء السجل</Submit></form>
            <form action={reject} className="row" style={{ gap: 4, flexWrap: "nowrap" }}><input type="hidden" name="id" value={a.id} /><input name="note" placeholder="سبب الرفض" style={{ width: 120 }} /><Submit className="btn btn-sm btn-danger" confirm="رفض الطلب؟">رفض</Submit></form>
          </div>}</td>}
        </tr>))}</tbody>
    </table>
  );
}
