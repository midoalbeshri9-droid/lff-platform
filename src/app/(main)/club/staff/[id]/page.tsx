import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { staff, staffDocuments, documentTypes } from "@/db/schema";
import { requireClubUser } from "@/lib/auth";
import { REG_STATUS, DOC_STATUS, STAFF_ROLE, STAFF_GROUP, staffGroup, LICENSED_ROLES, COACH_LICENSE, COACH_LEVEL } from "@/lib/labels";
import { fileUrl } from "@/lib/storage";
import { staffDocTypes, staffMissing, staffRequiredDocs } from "@/lib/staffreg";
import { PageHead, Flash, Badge, Field, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { saveStaff, uploadStaffDoc, deleteStaffDoc, submitStaff, deleteStaff } from "../actions";

export default async function ClubStaffMember({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const u = await requireClubUser("club.view");
  const sp = await searchParams;
  const [s] = await db.select().from(staff).where(and(eq(staff.id, Number((await params).id)), eq(staff.clubId, u.clubId)));
  if (!s) notFound();
  const [docs, types, required, miss] = await Promise.all([
    db.select({ d: staffDocuments, type: documentTypes.name }).from(staffDocuments).innerJoin(documentTypes, eq(documentTypes.id, staffDocuments.documentTypeId))
      .where(eq(staffDocuments.staffId, s.id)).orderBy(desc(staffDocuments.id)),
    staffDocTypes(), staffRequiredDocs(s), staffMissing(s),
  ]);
  const editable = ["DRAFT", "NEEDS_CORRECTION"].includes(s.status) && u.can("club.edit");
  const lic = LICENSED_ROLES.includes(s.role);
  const g = staffGroup(s.role);
  const ro = !editable;
  return (
    <>
      <PageHead title={s.fullName} sub={<>{STAFF_GROUP[g].label} — {STAFF_ROLE[s.role]} <Badge v={REG_STATUS[s.status]} /></>} crumbs={[["المدربون والإداريون", "/club/staff"], [s.fullName]]} />
      <Flash sp={sp} />
      {s.status === "NEEDS_CORRECTION" && s.decisionReason && <div className="alert warn">↩ أعادته لجنة القيد: <strong>{s.decisionReason}</strong></div>}
      {s.status === "REJECTED" && s.decisionReason && <div className="alert err">رُفض: {s.decisionReason}</div>}

      <form action={saveStaff} className="card">
        <input type="hidden" name="id" value={s.id} />
        <div className="row" style={{ alignItems: "flex-start", gap: 20 }}>
          <div>{s.photoKey ? <img src={fileUrl(s.photoKey)!} alt="" style={{ width: 110, height: 140, objectFit: "cover", borderRadius: 8 }} /> : <div className="ph" style={{ width: 110, height: 140, display: "grid", placeItems: "center", fontSize: 40 }}>👤</div>}</div>
          <fieldset disabled={ro} style={{ border: 0, padding: 0, margin: 0, flex: 1 }}>
            <fieldset className="form-sec"><legend>التسجيل</legend>
              <div className="form f3">
                <Field label="الدور والصفة *"><select name="role" defaultValue={s.role}>
                  {(["COACH", "OFFICIAL"] as const).map((k) => <optgroup key={k} label={STAFF_GROUP[k].label}>{STAFF_GROUP[k].roles.map((r) => <option key={r} value={r}>{STAFF_ROLE[r]}</option>)}</optgroup>)}
                </select></Field>
                {lic && <Field label="مستوى المدرب *"><select name="level" defaultValue={s.level ?? "AMATEUR"}>{Object.entries(COACH_LEVEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>}
              </div>
            </fieldset>
            <fieldset className="form-sec"><legend>البيانات الشخصية</legend>
              <div className="form f3">
                <Field label="الاسم الكامل *"><input name="fullName" defaultValue={s.fullName} required /></Field>
                <Field label="الرقم الوطني / الجواز *"><input name="nationalId" dir="ltr" defaultValue={s.nationalId ?? ""} /></Field>
                <Field label="الجنسية"><input name="nationality" defaultValue={s.nationality} /></Field>
                <Field label="تاريخ الميلاد *"><input type="date" name="dateOfBirth" defaultValue={s.dateOfBirth ?? ""} /></Field>
                <Field label="الصورة الشخصية *"><input type="file" name="photo" accept="image/*" /></Field>
              </div>
            </fieldset>
            <fieldset className="form-sec"><legend>بيانات الاتصال</legend>
              <div className="form f3">
                <Field label="الهاتف"><input type="tel" name="phone" dir="ltr" defaultValue={s.phone ?? ""} /></Field>
                <Field label="البريد الإلكتروني"><input type="email" name="email" dir="ltr" defaultValue={s.email ?? ""} /></Field>
                <Field label="العنوان"><input name="address" defaultValue={s.address ?? ""} /></Field>
              </div>
            </fieldset>
            {lic && (
              <fieldset className="form-sec"><legend>الرخصة التدريبية (الشهادات)</legend>
                <div className="form f3">
                  <Field label="الرخصة *"><select name="licenseLevel" defaultValue={s.licenseLevel ?? ""}><option value="">—</option>{COACH_LICENSE.map((x) => <option key={x} value={x}>{x}</option>)}</select></Field>
                  <Field label="رقم الرخصة"><input name="licenseNo" dir="ltr" defaultValue={s.licenseNo ?? ""} /></Field>
                  <Field label="صالحة من"><input type="date" name="licenseFrom" defaultValue={s.licenseFrom ?? ""} /></Field>
                  <Field label="صالحة حتى *"><input type="date" name="licenseUntil" defaultValue={s.licenseUntil ?? ""} /></Field>
                </div>
              </fieldset>
            )}
            {editable && <Submit>💾 حفظ</Submit>}
          </fieldset>
        </div>
      </form>

      <div className="card table-wrap">
        <h3>المستندات</h3>
        {required.length > 0 && <p className="muted" style={{ fontSize: ".85rem" }}>الإلزامية لهذا الدور: {required.map((t) => <span key={t.id} style={{ marginInlineEnd: 10 }}>{docs.some((d) => d.d.documentTypeId === t.id && d.d.status !== "REJECTED") ? "✅" : "⬜"} {t.name}</span>)}</p>}
        {docs.length > 0 && (
          <table className="t no-num"><thead><tr><th>المستند</th><th>الملف</th><th>الحالة</th><th></th></tr></thead>
            <tbody>{docs.map(({ d, type }) => (
              <tr key={d.id}><td>{type}</td><td><a href={fileUrl(d.fileKey)!} target="_blank">📎 {d.originalName}</a></td>
                <td><Badge v={DOC_STATUS[d.status]} />{d.rejectionReason && <div className="danger-text" style={{ fontSize: ".8rem" }}>{d.rejectionReason}</div>}</td>
                <td>{editable && d.status === "PENDING" && <form action={deleteStaffDoc}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="docId" value={d.id} /><Submit className="btn btn-sm btn-ghost" confirm="حذف المستند؟">حذف</Submit></form>}</td></tr>))}</tbody></table>
        )}
        {s.documentKey && <p className="muted">مستند سابق: <a href={fileUrl(s.documentKey)!} target="_blank">📎 عرض</a></p>}
        {editable && (
          <form action={uploadStaffDoc} className="row mt">
            <input type="hidden" name="id" value={s.id} />
            <select name="documentTypeId" required defaultValue=""><option value="" disabled>نوع المستند</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}{required.some((r) => r.id === t.id) ? " *" : ""}</option>)}</select>
            <input type="file" name="file" accept="application/pdf,image/*" required />
            <Submit className="btn btn-light">⬆ رفع</Submit>
          </form>
        )}
      </div>

      {editable && (
        <div className="card">
          <h3>الإرسال إلى لجنة القيد</h3>
          {miss.length ? <p className="danger-text">قبل الإرسال أكمل: {miss.join("، ")}</p> : <p style={{ color: "var(--green-d)" }}>✓ الملف مكتمل وجاهز للإرسال.</p>}
          <div className="btn-row">
            {u.can("club.submit") && <form action={submitStaff}><input type="hidden" name="id" value={s.id} /><Submit className="btn btn-primary">📤 إرسال للاعتماد</Submit></form>}
            {s.status === "DRAFT" && <form action={deleteStaff}><input type="hidden" name="id" value={s.id} /><Submit className="btn btn-ghost" confirm="حذف هذا الملف؟">حذف</Submit></form>}
          </div>
        </div>
      )}
    </>
  );
}
