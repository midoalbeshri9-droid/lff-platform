import { and, eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { staff, sanctions } from "@/db/schema";
import { requireClubUser } from "@/lib/auth";
import { getCurrentSeason } from "@/lib/registration";
import { REG_STATUS, STAFF_ROLE } from "@/lib/labels";
import { fileUrl } from "@/lib/storage";
import { PageHead, Flash, Badge, Field, Options, Empty, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { saveStaff, submitStaff, deleteStaff } from "../actions";

export default async function ClubStaff({ searchParams }: { searchParams: SP }) {
  const u = await requireClubUser("club.view");
  const sp = await searchParams;
  const season = await getCurrentSeason();
  const rows = await db.select().from(staff).where(and(eq(staff.clubId, u.clubId), eq(staff.seasonId, season?.id ?? 0))).orderBy(staff.role, staff.fullName);
  const bans = await db.select().from(sanctions).where(and(eq(sanctions.clubId, u.clubId), eq(sanctions.targetType, "STAFF"), eq(sanctions.status, "ACTIVE"))).orderBy(desc(sanctions.id));
  const form = (s?: (typeof rows)[number]) => (
    <form action={saveStaff} className="form f3 mt">
      {s && <input type="hidden" name="id" value={s.id} />}
      <Field label="الاسم الكامل *"><input type="text" name="fullName" defaultValue={s?.fullName} required /></Field>
      <Field label="الصفة *"><select name="role" defaultValue={s?.role ?? "COACH"}><Options map={STAFF_ROLE} /></select></Field>
      <Field label="الرقم الوطني"><input type="text" name="nationalId" dir="ltr" defaultValue={s?.nationalId ?? ""} /></Field>
      <Field label="الجنسية"><input type="text" name="nationality" defaultValue={s?.nationality ?? "ليبي"} /></Field>
      <Field label="تاريخ الميلاد"><input type="date" name="dateOfBirth" defaultValue={s?.dateOfBirth ?? ""} /></Field>
      <Field label="الهاتف"><input type="tel" name="phone" dir="ltr" defaultValue={s?.phone ?? ""} /></Field>
      <Field label="رقم الرخصة التدريبية"><input type="text" name="licenseNo" defaultValue={s?.licenseNo ?? ""} /></Field>
      <Field label="مستوى الرخصة"><input type="text" name="licenseLevel" defaultValue={s?.licenseLevel ?? ""} placeholder="A / B / C / Pro" /></Field>
      <Field label="الصورة الشخصية"><input type="file" name="photo" accept="image/*" /></Field>
      <Field label="الرخصة أو الهوية (PDF/صورة)"><input type="file" name="document" accept="application/pdf,image/*" /></Field>
      <div className="full"><Submit>حفظ</Submit></div>
    </form>
  );
  return (
    <>
      <PageHead title="الإداريون والجهاز الفني" sub={`الموسم ${season?.name ?? ""} — يُعتمدون من لجنة القيد`} />
      <Flash sp={sp} />
      {bans.length > 0 && <div className="alert err">عقوبات سارية على إداريين: {bans.map((b) => `${b.number}: ${b.reason}`).join(" — ")}</div>}
      <div className="card table-wrap">
        {rows.length === 0 ? <Empty>لم يُضف أحد بعد</Empty> : (
          <table className="t"><thead><tr><th></th><th>الاسم</th><th>الصفة</th><th>الرخصة</th><th>الحالة</th><th></th></tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.id}>
                <td>{s.photoKey ? <img className="thumb" src={fileUrl(s.photoKey)!} alt="" /> : <span className="ph">👤</span>}</td>
                <td><strong>{s.fullName}</strong>{s.decisionReason && s.status !== "APPROVED" && <div className="danger-text" style={{ fontSize: ".8rem" }}>{s.decisionReason}</div>}</td>
                <td>{STAFF_ROLE[s.role]}</td><td>{s.licenseNo ?? "—"} {s.licenseLevel && `(${s.licenseLevel})`}</td>
                <td><Badge v={REG_STATUS[s.status]} /></td>
                <td>{["DRAFT", "NEEDS_CORRECTION"].includes(s.status) && u.can("club.edit") && (
                  <details><summary className="btn btn-sm btn-light">تعديل / إرسال</summary>
                    <div style={{ minWidth: 360 }}>{form(s)}
                      <div className="btn-row mt">
                        {u.can("club.submit") && <form action={submitStaff}><input type="hidden" name="id" value={s.id} /><Submit className="btn btn-sm btn-primary">📤 إرسال للاعتماد</Submit></form>}
                        {s.status === "DRAFT" && <form action={deleteStaff}><input type="hidden" name="id" value={s.id} /><Submit className="btn btn-sm btn-ghost" confirm="حذف؟">حذف</Submit></form>}
                      </div></div>
                  </details>)}</td>
              </tr>))}</tbody></table>
        )}
      </div>
      {u.can("club.edit") && <details className="box card"><summary>+ إضافة إداري / مدرب</summary>{form()}</details>}
    </>
  );
}
