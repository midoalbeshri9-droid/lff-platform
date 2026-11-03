import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, ne, desc } from "drizzle-orm";
import { db } from "@/db";
import { registrations, clubs, seasons, ageCategories } from "@/db/schema";
import { scopeOf, clubIn, regIn, guardPage, inScopeReg, inScopePlayer } from "@/lib/scope";
import { requireUser } from "@/lib/auth";
import { loadRegistration } from "@/lib/regview";
import { REG_STATUS, REG_TYPE } from "@/lib/labels";
import { fileUrl } from "@/lib/storage";
import { fmtDateTime } from "@/lib/util";
import { PageHead, Flash, Badge, Field, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { RegSummary, Timeline, DocStatusBadge, docMissing } from "@/components/RegParts";
import { reviewDoc, approveAllDocs, decide, updateRegistrationMeta, endRegistration } from "../../actions";
import { ContractView } from "@/components/Contract";

export default async function Review({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const u = await requireUser("reg.view");
  const id = Number((await params).id);
  const sp = await searchParams;
  const x = await loadRegistration(id);
  if (!x) notFound();
  guardPage(await inScopeReg(u, id));
  const { r, p } = x;
  const canReview = u.can("reg.review") && ["SUBMITTED", "NEEDS_CORRECTION"].includes(r.status);
  const missing = docMissing(x);
  const pendingDocs = x.docs.filter((d) => d.d.status === "PENDING").length;
  const history = await db
    .select({ r: registrations, club: clubs.name, season: seasons.name })
    .from(registrations).innerJoin(clubs, eq(clubs.id, registrations.clubId)).innerJoin(seasons, eq(seasons.id, registrations.seasonId))
    .where(and(eq(registrations.playerId, p.id), ne(registrations.id, id))).orderBy(desc(registrations.id));
  const cats = await db.select().from(ageCategories).orderBy(ageCategories.sortOrder);

  return (
    <>
      <PageHead title={`${REG_TYPE[r.type]} — ${p.fullName}`} crumbs={[["طلبات القيد", "/registration/requests"], [`#${r.id}`]]}
        actions={<>
          <Link className="btn btn-light" href={`/registration/players/${p.id}`}>ملف اللاعب</Link>
          {r.status === "APPROVED" && u.can("cards.print") && <Link className="btn btn-gold" href={`/registration/cards?ids=${r.id}`}>🪪 طباعة البطاقة</Link>}
        </>} />
      <Flash sp={sp} />
      <div className="grid g-side">
        <div>
          <RegSummary x={x} />
          {(x.contract || p.professionalLevel !== "AMATEUR") && (
            <div className="card"><h2>العقد</h2><ContractView c={x.contract} showMoney={u.can("reg.contracts")} /></div>
          )}
          <div className="card">
            <div className="card-head">
              <h2>المستندات ({x.docs.length})</h2>
              {canReview && pendingDocs > 0 && (
                <form action={approveAllDocs}><input type="hidden" name="id" value={id} /><Submit className="btn btn-sm btn-light" confirm="قبول كل المستندات المعلقة؟">✓ قبول كل المعلّق</Submit></form>
              )}
            </div>
            {missing.length > 0 && <div className="alert err">مستندات إلزامية ناقصة: {missing.map((m) => m.name).join("، ")}</div>}
            {x.docs.map(({ d, type }) => (
              <div key={d.id} className="doc-row" style={{ gridTemplateColumns: "1fr" }}>
                <div className="row">
                  <a href={fileUrl(d.fileKey)!} target="_blank" className="name">📎 {type}</a>
                  <DocStatusBadge s={d.status} />
                  <small>{d.originalName} — {(d.size / 1024).toFixed(0)}KB — {fmtDateTime(d.uploadedAt)} — {d.uploadedBy}</small>
                  {d.reviewedBy && <small>— راجعه: {d.reviewedBy}</small>}
                </div>
                {d.mime.startsWith("image/") && <a href={fileUrl(d.fileKey)!} target="_blank"><img src={fileUrl(d.fileKey)!} alt="" style={{ maxHeight: 180, maxWidth: "100%", borderRadius: 8, border: "1px solid var(--line)" }} /></a>}
                {d.rejectionReason && <div className="danger-text">سبب الرفض: {d.rejectionReason}</div>}
                {canReview && d.status === "PENDING" && (
                  <form action={reviewDoc} className="row">
                    <input type="hidden" name="id" value={id} /><input type="hidden" name="docId" value={d.id} />
                    <input type="text" name="reason" placeholder="سبب الرفض (عند الرفض)" style={{ flex: 1, minWidth: 200 }} />
                    <Submit name="decision" value="approve" className="btn btn-sm btn-primary">✓ قبول</Submit>
                    <Submit name="decision" value="reject" className="btn btn-sm btn-danger">✗ رفض</Submit>
                  </form>
                )}
              </div>
            ))}
          </div>

          <div className="card table-wrap">
            <h3>سجل قيود اللاعب السابقة</h3>
            {history.length === 0 ? <p className="muted">لا توجد قيود سابقة</p> : (
              <table className="t"><tbody>{history.map((h) => (
                <tr key={h.r.id}><td>{h.season}</td><td>{h.club}</td><td>{REG_TYPE[h.r.type]}</td><td className="kbd">{h.r.number ?? "—"}</td><td><Badge v={REG_STATUS[h.r.status]} /></td>
                  <td><Link href={`/registration/requests/${h.r.id}`}>عرض</Link></td></tr>
              ))}</tbody></table>
            )}
          </div>
        </div>

        <div>
          {canReview && (
            <div className="card" style={{ borderTop: "4px solid var(--lff-gold)" }}>
              <h3>قرار اللجنة</h3>
              <form action={decide} className="stack">
                <input type="hidden" name="id" value={id} />
                <Field label="الملاحظة / السبب" hint="إلزامي عند الرفض أو الإعادة — يظهر للنادي"><textarea name="reason" /></Field>
                <label className="check"><input type="checkbox" name="override" /> تجاوز الشروط بقرار اللجنة (مستندات/اعتراض)</label>
                <Submit name="decision" value="approve" className="btn btn-primary w100" confirm="اعتماد القيد ومنح رقم قيد؟">✓ اعتماد القيد</Submit>
                <Submit name="decision" value="return" className="btn btn-gold w100">↩ إعادة للنادي للاستكمال</Submit>
                <Submit name="decision" value="reject" className="btn btn-danger w100" confirm="رفض الطلب نهائيًا؟">✗ رفض الطلب</Submit>
              </form>
            </div>
          )}
          {u.can("reg.edit") && (
            <details className="box card">
              <summary>تعديل بيانات القيد</summary>
              <form action={updateRegistrationMeta} className="form f1 mt">
                <input type="hidden" name="id" value={id} />
                <Field label="الفئة العمرية"><select name="categoryId" defaultValue={r.categoryId ?? ""}><option value="">—</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
                <Field label="رقم القميص"><input type="number" name="shirtNumber" defaultValue={r.shirtNumber ?? ""} /></Field>
                <Field label="نهاية الإعارة"><input type="date" name="loanEndDate" defaultValue={r.loanEndDate ?? ""} /></Field>
                <Submit>حفظ</Submit>
              </form>
            </details>
          )}
          {u.can("reg.edit") && r.status === "APPROVED" && (
            <details className="box card">
              <summary>إنهاء / شطب القيد</summary>
              <form action={endRegistration} className="stack mt">
                <input type="hidden" name="id" value={id} />
                <textarea name="reason" placeholder="سبب الإنهاء" required />
                <Submit className="btn btn-danger" confirm="إنهاء القيد؟ لن يكون اللاعب مؤهلًا للمباريات.">إنهاء القيد</Submit>
              </form>
            </details>
          )}
          {x.prints.length > 0 && (
            <div className="card"><h3>طباعة البطاقة</h3>
              {x.prints.map((pr) => <div key={pr.id} className="muted" style={{ fontSize: ".85rem" }}>{fmtDateTime(pr.printedAt)} — {pr.printedBy}{pr.isReplacement && " (بديلة)"}</div>)}
            </div>
          )}
          <Timeline x={x} />
        </div>
      </div>
    </>
  );
}
