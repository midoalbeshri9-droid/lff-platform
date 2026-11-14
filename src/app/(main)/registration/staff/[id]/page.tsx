import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { staff, staffDocuments, documentTypes, clubs, seasons } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { guardPage, inScopeStaff } from "@/lib/scope";
import { REG_STATUS, DOC_STATUS, STAFF_ROLE, STAFF_GROUP, staffGroup, LICENSED_ROLES, COACH_LEVEL } from "@/lib/labels";
import { fileUrl } from "@/lib/storage";
import { fmtDate, fmtDateTime } from "@/lib/util";
import { staffRequiredDocs, staffWarnings, personByNationalId } from "@/lib/staffreg";
import { feeAmount } from "@/lib/finance";
import { PageHead, Flash, Badge, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { decideStaff, reviewStaffDoc, approveAllStaffDocs } from "../../actions";

const Row = ({ k, v }: { k: string; v?: React.ReactNode }) => <div className="kv"><span className="muted">{k}</span><strong>{v || "—"}</strong></div>;

export default async function StaffMemberReview({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const u = await requireUser("reg.view", "reg.staff");
  const sp = await searchParams;
  const id = Number((await params).id);
  const [row] = await db.select({ s: staff, club: clubs.name, season: seasons.name }).from(staff).innerJoin(clubs, eq(clubs.id, staff.clubId)).innerJoin(seasons, eq(seasons.id, staff.seasonId)).where(eq(staff.id, id));
  if (!row) notFound();
  guardPage(await inScopeStaff(u, id));
  const { s, club, season } = row;
  const [docs, required] = await Promise.all([
    db.select({ d: staffDocuments, type: documentTypes.name }).from(staffDocuments).innerJoin(documentTypes, eq(documentTypes.id, staffDocuments.documentTypeId)).where(eq(staffDocuments.staffId, id)).orderBy(desc(staffDocuments.id)),
    staffRequiredDocs(s),
  ]);
  const warn = staffWarnings(s);
  const prev = s.nationalId ? await personByNationalId(s.nationalId, s.id) : null;
  const lic = LICENSED_ROLES.includes(s.role);
  const fee = lic ? await feeAmount("STAFF_REG", s.level === "PROFESSIONAL") : 0;
  const canDecide = s.status === "SUBMITTED" && u.can("reg.staff");
  return (
    <>
      <PageHead title={s.fullName} sub={<>{club} — {STAFF_GROUP[staffGroup(s.role)].label}: {STAFF_ROLE[s.role]} — موسم {season} <Badge v={REG_STATUS[s.status]} /></>} crumbs={[["المدربون والإداريون", "/registration/staff"], [s.fullName]]} />
      <Flash sp={sp} />
      {warn.length > 0 && <div className="alert warn">⚠ للتدقيق:<ul>{warn.map((w) => <li key={w}>{w}</li>)}</ul></div>}
      {prev && <div className="alert info">هذا الشخص مسجّل مسبقًا {prev.source === "player" ? "كلاعب" : "كمدرب/إداري"} بنفس الرقم الوطني ({prev.fullName}).</div>}
      <div className="grid g2">
        <div className="card">
          <h3>البيانات</h3>
          <div className="row" style={{ gap: 16, alignItems: "flex-start" }}>
            {s.photoKey ? <img src={fileUrl(s.photoKey)!} alt="" style={{ width: 100, height: 128, objectFit: "cover", borderRadius: 8 }} /> : <span className="ph">👤</span>}
            <div style={{ flex: 1 }}>
              <Row k="الرقم الوطني / الجواز" v={<span className="kbd">{s.nationalId}</span>} />
              <Row k="الجنسية" v={s.nationality} />
              <Row k="تاريخ الميلاد" v={fmtDate(s.dateOfBirth)} />
              <Row k="الهاتف" v={s.phone} />
              <Row k="البريد" v={s.email} />
              <Row k="العنوان" v={s.address} />
            </div>
          </div>
        </div>
        <div className="card">
          <h3>{lic ? "المستوى والرخصة" : "التسجيل"}</h3>
          <Row k="الدور" v={STAFF_GROUP[staffGroup(s.role)].label} />
          <Row k="الصفة" v={STAFF_ROLE[s.role]} />
          {lic && <>
            <Row k="المستوى" v={s.level ? COACH_LEVEL[s.level] : null} />
            <Row k="الرخصة" v={s.licenseLevel} />
            <Row k="رقم الرخصة" v={s.licenseNo} />
            <Row k="الصلاحية" v={s.licenseFrom || s.licenseUntil ? `${fmtDate(s.licenseFrom)} ← ${fmtDate(s.licenseUntil)}` : null} />
          </>}
          <Row k="رسوم القيد" v={lic ? (fee > 0 ? `${fee} د.ل — تُسجّل على النادي عند الاعتماد` : "0 (لم تُحدد في الرسوم)") : "بلا رسوم (إداري)"} />
          <Row k="أُرسل" v={fmtDateTime(s.submittedAt)} />
          {s.decidedAt && <Row k="القرار" v={`${s.decidedBy} — ${fmtDateTime(s.decidedAt)}`} />}
        </div>
      </div>

      <div className="card table-wrap">
        <div className="card-head"><h3>المستندات</h3>
          {canDecide && docs.some((d) => d.d.status === "PENDING") && <form action={approveAllStaffDocs}><input type="hidden" name="id" value={s.id} /><Submit className="btn btn-sm btn-light">✔ قبول كل المعلّق</Submit></form>}</div>
        {required.length > 0 && <p className="muted" style={{ fontSize: ".85rem" }}>الإلزامية: {required.map((t) => <span key={t.id} style={{ marginInlineEnd: 10 }}>{docs.some((d) => d.d.documentTypeId === t.id && d.d.status === "APPROVED") ? "✅" : docs.some((d) => d.d.documentTypeId === t.id && d.d.status === "PENDING") ? "🕓" : "⬜"} {t.name}</span>)}</p>}
        <table className="t no-num"><thead><tr><th>المستند</th><th>الملف</th><th>الحالة</th><th></th></tr></thead>
          <tbody>{docs.map(({ d, type }) => (
            <tr key={d.id}><td>{type}</td><td><a href={fileUrl(d.fileKey)!} target="_blank">📎 {d.originalName}</a></td>
              <td><Badge v={DOC_STATUS[d.status]} />{d.rejectionReason && <div className="danger-text" style={{ fontSize: ".8rem" }}>{d.rejectionReason}</div>}</td>
              <td>{canDecide && d.status === "PENDING" && (
                <form action={reviewStaffDoc} className="row" style={{ flexWrap: "nowrap" }}>
                  <input type="hidden" name="id" value={s.id} /><input type="hidden" name="docId" value={d.id} />
                  <input name="reason" placeholder="سبب الرفض" style={{ width: 140 }} />
                  <Submit name="decision" value="approve" className="btn btn-sm btn-primary">قبول</Submit>
                  <Submit name="decision" value="reject" className="btn btn-sm btn-danger">رفض</Submit>
                </form>)}</td></tr>))}
            {s.documentKey && <tr><td>مستند سابق</td><td><a href={fileUrl(s.documentKey)!} target="_blank">📎 عرض</a></td><td></td><td></td></tr>}
          </tbody></table>
      </div>

      {canDecide && (
        <form action={decideStaff} className="card">
          <input type="hidden" name="id" value={s.id} />
          <h3>القرار</h3>
          <div className="row">
            <input name="reason" placeholder="السبب (إلزامي للإعادة أو الرفض)" style={{ flex: 1, minWidth: 260 }} />
            <Submit name="decision" value="approve" className="btn btn-primary">✔ اعتماد القيد</Submit>
            <Submit name="decision" value="return" className="btn btn-gold">↩ إعادة للنادي</Submit>
            <Submit name="decision" value="reject" className="btn btn-danger" confirm="رفض الطلب نهائيًا؟">رفض</Submit>
          </div>
        </form>
      )}
    </>
  );
}
