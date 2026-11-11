import { notFound } from "next/navigation";
import { requireClubUser } from "@/lib/auth";
import { loadRegistration } from "@/lib/regview";
import { lastApproved, openWindow } from "@/lib/registration";
import { fileUrl } from "@/lib/storage";
import { fmtDateTime } from "@/lib/util";
import { PageHead, Flash, Field, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { PlayerFields } from "@/components/PlayerForm";
import { RegSummary, Timeline, DocStatusBadge, docMissing } from "@/components/RegParts";
import { updateDraft, uploadDocument, deleteDocument, submitRequest, cancelRequest } from "../../actions";
import { ContractBrief } from "@/components/EContract";
import { createContract } from "../../contracts/actions";
import { needsContract } from "@/lib/registration";

export default async function ClubReg({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const u = await requireClubUser("club.view");
  const { id } = await params;
  const sp = await searchParams;
  const x = await loadRegistration(Number(id));
  if (!x || x.r.clubId !== u.clubId) notFound();
  const { r, p } = x;
  const editable = (r.status === "DRAFT" || r.status === "NEEDS_CORRECTION") && u.can("club.edit");
  const limited = !(p.createdByClubId === u.clubId && !(await lastApproved(p.id)));
  const missing = docMissing(x);
  const win = await openWindow(r.seasonId, u.clubId);

  return (
    <>
      <PageHead title={`طلب ${r.number ? "قيد " + r.number : "#" + r.id}`} crumbs={[["الطلبات", "/club/requests"], [p.fullName]]} />
      <Flash sp={sp} />
      <div className="grid g-side">
        <div>
          <RegSummary x={x} />

          {(needsContract(p.professionalLevel) || x.contract) && (
            <div className="card" id="contract">
              <div className="card-head"><h2>العقد</h2>{!(x.contract && ["SUBMITTED", "ACTIVE"].includes(x.contract.status)) && editable && r.type !== "LOAN" && <span className="b b-red">مطلوب قبل الإرسال</span>}</div>
              <ContractBrief c={x.contract} href={x.contract ? `/club/contracts/${x.contract.id}` : "#"} showMoney
                createSlot={u.can("club.edit") && <form action={createContract}><input type="hidden" name="regId" value={r.id} /><Submit className="btn btn-gold">📄 كتابة العقد إلكترونيًا</Submit></form>} />
              <p className="muted" style={{ fontSize: ".82rem" }}>العقد يُكتب على نموذج الاتحاد الموحد، يُطبع ويوقّع، ثم تُرفع نسخته الموقّعة ويُرسل للجنة أوضاع اللاعبين.</p>
            </div>
          )}

          <div className="card">
            <div className="card-head"><h2>المستندات</h2>{missing.length > 0 && <span className="b b-red">ناقص {missing.length}</span>}</div>
            {x.required.map((t) => {
              const has = x.docs.filter((d) => d.d.documentTypeId === t.id);
              return (
                <div key={t.id} className="doc-row">
                  <div>
                    <div className="name">{t.name}<span className="req-star">*</span></div>
                    {has.length === 0 && <span className="bad-mark">لم يُرفع بعد</span>}
                  </div>
                  <div />
                </div>
              );
            })}
            {x.docs.map(({ d, type }) => (
              <div key={d.id} className="doc-row">
                <div>
                  <div><a href={fileUrl(d.fileKey)!} target="_blank">📎 {type}</a> <DocStatusBadge s={d.status} /></div>
                  <small>{d.originalName} — {fmtDateTime(d.uploadedAt)}</small>
                  {d.rejectionReason && <div className="danger-text" style={{ fontSize: ".85rem" }}>سبب الرفض: {d.rejectionReason}</div>}
                </div>
                {editable && d.status !== "APPROVED" && (
                  <form action={deleteDocument}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="docId" value={d.id} /><Submit className="btn btn-sm btn-light" confirm="حذف المستند؟">حذف</Submit></form>
                )}
              </div>
            ))}
            {editable && (
              <form key={`up-${x.docs.length}-${missing.map((m) => m.id).join(".")}`} action={uploadDocument} className="form mt">
                <input type="hidden" name="id" value={r.id} />
                <Field label="نوع المستند">
                  <select name="documentTypeId" required defaultValue={missing[0]?.id ?? ""}>
                    <option value="">— اختر —</option>
                    {x.allTypes.map((t) => <option key={t.id} value={t.id}>{t.name}{x.required.some((q) => q.id === t.id) ? " *" : ""}</option>)}
                  </select>
                </Field>
                <Field label="الملف (PDF أو صورة، حتى 8MB)"><input type="file" name="file" accept="application/pdf,image/*" required /></Field>
                <div className="full"><Submit className="btn btn-gold">⬆ رفع المستند</Submit></div>
              </form>
            )}
          </div>

          {editable && (
            <details className="box card" open={r.status === "NEEDS_CORRECTION"}>
              <summary>تعديل بيانات اللاعب والطلب</summary>
              {limited && <p className="muted">بيانات الهوية تعدّلها لجنة القيد فقط لأن اللاعب سبق اعتماده. يمكنك تعديل الاتصال والمركز والصورة.</p>}
              <form action={updateDraft} className="form mt">
                <input type="hidden" name="id" value={r.id} />
                <PlayerFields p={p} limited={limited} />
                <Field label="رقم القميص"><input type="number" name="shirtNumber" min={1} max={99} defaultValue={r.shirtNumber ?? ""} /></Field>
                {r.type === "LOAN" && <Field label="نهاية الإعارة"><input type="date" name="loanEndDate" defaultValue={r.loanEndDate ?? ""} /></Field>}
                <Field label="موافقة ولي الأمر (للقاصر)"><label className="check"><input type="checkbox" name="parentalConsent" defaultChecked={r.parentalConsent} /> تم الحصول على الموافقة</label></Field>
                <Field label="ملاحظات للجنة" full><textarea name="notes" defaultValue={r.notes ?? ""} /></Field>
                <div className="full"><Submit>حفظ التعديلات</Submit></div>
              </form>
            </details>
          )}
        </div>

        <div>
          {editable && (
            <div className="card" style={{ borderTop: "4px solid var(--lff-gold)" }}>
              <h3>إرسال الطلب</h3>
              {!win && <div className="alert warn">فترة القيد مغلقة — لا يمكن الإرسال الآن.</div>}
              {missing.length > 0 && <div className="alert err">أكمل المستندات الإلزامية: {missing.map((m) => m.name).join("، ")}</div>}
              {!p.photoKey && <div className="alert err">الصورة الشخصية مطلوبة.</div>}
              {needsContract(p.professionalLevel) && !x.contract && r.type !== "LOAN" && <div className="alert err">أدخل بيانات العقد (لاعب محترف/تحت العقد).</div>}
              {r.originResponse === "PENDING" && <div className="alert info">سيُطلب رأي النادي السابق تلقائيًا بعد الإرسال.</div>}
              {u.can("club.submit") ? (
                <form action={submitRequest}><input type="hidden" name="id" value={r.id} />
                  <Submit className="btn btn-primary w100" confirm="بعد الإرسال لا يمكن التعديل حتى ترد لجنة القيد. متابعة؟">📤 إرسال إلى لجنة القيد</Submit></form>
              ) : <p className="muted">الإرسال لمدير حساب النادي.</p>}
            </div>
          )}
          {["DRAFT", "NEEDS_CORRECTION", "SUBMITTED"].includes(r.status) && u.can("club.edit") && (
            <form action={cancelRequest} className="card"><input type="hidden" name="id" value={r.id} />
              <Submit className="btn btn-light w100" confirm="إلغاء الطلب نهائيًا؟">إلغاء الطلب</Submit></form>
          )}
          <Timeline x={x} />
        </div>
      </div>
    </>
  );
}
