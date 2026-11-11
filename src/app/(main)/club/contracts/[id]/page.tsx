import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { contracts, players, seasons } from "@/db/schema";
import { requireClubUser } from "@/lib/auth";
import { amountWords, missingForSubmit } from "@/lib/contracts";
import { CONTRACT_STATUS } from "@/lib/labels";
import { fmtDateTime } from "@/lib/util";
import { fileUrl } from "@/lib/storage";
import { PageHead, Badge, Flash, Field, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { EContractSummary } from "@/components/EContract";
import { saveContractDoc, uploadSignedContract, submitContract } from "../actions";

const MONEY_KEYS = ["totalValue", "signingBonus", "monthlySalary", "housingAmount", "transportAmount"] as const;

export default async function ClubContract({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const u = await requireClubUser("club.view");
  const { id } = await params;
  const sp = await searchParams;
  const [row] = await db.select({ c: contracts, name: players.fullName }).from(contracts).innerJoin(players, eq(players.id, contracts.playerId))
    .where(and(eq(contracts.id, Number(id)), eq(contracts.clubId, u.clubId)));
  if (!row) notFound();
  const { c, name } = row;
  const d = c.doc!;
  const words = Object.fromEntries(MONEY_KEYS.map((k) => [k, amountWords(c[k], c.currency)]));
  const editable = (c.status === "DRAFT" || c.status === "RETURNED") && u.can("club.edit");
  const miss = missingForSubmit(c);
  const allSeasons = await db.select({ name: seasons.name }).from(seasons).orderBy(seasons.startDate);
  const W = ({ k }: { k: string }) => (words[k] ? <small className="muted">بالحروف: {words[k]}</small> : null);

  return (
    <>
      <PageHead title={`عقد لاعب محترف — ${name}`} sub={<><Badge v={CONTRACT_STATUS[c.status]} /> {c.number && <span className="kbd">رقم {c.number}</span>}</>}
        crumbs={[["العقود", "/club/contracts"], [name]]}
        actions={<Link className="btn btn-light" href={`/print/contract/${c.id}`} target="_blank">🖨 طباعة العقد (نموذج الاتحاد)</Link>} />
      <Flash sp={sp} />
      {c.status === "RETURNED" && c.returnNote && <div className="alert warn">↩ أعادته لجنة أوضاع اللاعبين للاستكمال: <strong>{c.returnNote}</strong></div>}

      {editable && (
        <div className="card">
          <h3>خطوات العقد</h3>
          <ol style={{ margin: 0, paddingInlineStart: 20, lineHeight: 1.9 }}>
            <li>أكمل بيانات العقد أدناه واحفظها.</li>
            <li>اطبع العقد من زر «طباعة العقد» — يخرج على نموذج الاتحاد الموحد ببياناتك.</li>
            <li>يوقّع الطرفان على جميع الصفحات، مع بصمة اللاعب وختم النادي.</li>
            <li>صوّر النسخة الموقّعة (PDF أو صور) وارفعها، ثم أرسل العقد للاعتماد.</li>
          </ol>
        </div>
      )}

      {editable ? (
        <form action={saveContractDoc} className="card">
          <input type="hidden" name="id" value={c.id} />
          <fieldset className="form-sec"><legend>التوقيع</legend>
            <div className="form f3">
              <Field label="تاريخ التوقيع"><input type="date" name="signDate" defaultValue={d.signDate} /></Field>
              <Field label="المدينة *"><input name="signCity" defaultValue={d.signCity} /></Field>
              <Field label="الدولة"><input name="signCountry" defaultValue={d.signCountry} /></Field>
            </div>
          </fieldset>
          <fieldset className="form-sec"><legend>الطرف الأول — النادي ({u.clubName})</legend>
            <div className="form f3">
              <Field label="العنوان"><input name="clubAddress" defaultValue={d.club.address} /></Field>
              <Field label="الهاتف"><input name="clubPhone" defaultValue={d.club.phone} dir="ltr" /></Field>
              <Field label="البريد الإلكتروني"><input type="email" name="clubEmail" defaultValue={d.club.email} dir="ltr" /></Field>
              <Field label="يمثله في التوقيع السيد *"><input name="repName" defaultValue={d.club.repName} /></Field>
              <Field label="بصفته"><input name="repTitle" defaultValue={d.club.repTitle} /></Field>
            </div>
          </fieldset>
          <fieldset className="form-sec"><legend>الطرف الثاني — اللاعب ({name})</legend>
            <div className="form f3">
              <Field label="الاسم بالإنجليزية"><input name="nameEn" defaultValue={d.player.nameEn} dir="ltr" /></Field>
              <Field label="الجنسية *"><input name="nationality" defaultValue={d.player.nationality} /></Field>
              <Field label="مكان الميلاد *"><input name="birthPlace" defaultValue={d.player.birthPlace} /></Field>
              <Field label="تاريخ الميلاد"><input type="date" name="birthDate" defaultValue={d.player.birthDate} /></Field>
              <Field label="نوع وثيقة الإثبات *"><select name="idType" defaultValue={d.player.idType}>
                {["", "الرقم الوطني", "جواز سفر", "بطاقة شخصية", "إقامة"].map((x) => <option key={x} value={x}>{x || "—"}</option>)}</select></Field>
              <Field label="رقم الإثبات الشخصي *"><input name="idNumber" defaultValue={d.player.idNumber} dir="ltr" /></Field>
              <Field label="مكان الإصدار"><input name="idIssuePlace" defaultValue={d.player.idIssuePlace} /></Field>
              <Field label="تاريخ الإصدار"><input type="date" name="idIssueDate" defaultValue={d.player.idIssueDate} /></Field>
              <Field label="صلاحيته حتى"><input type="date" name="idExpiry" defaultValue={d.player.idExpiry} /></Field>
              <Field label="العنوان"><input name="pAddress" defaultValue={d.player.address} /></Field>
              <Field label="الهاتف"><input name="pPhone" defaultValue={d.player.phone} dir="ltr" /></Field>
              <Field label="البريد الإلكتروني"><input type="email" name="pEmail" defaultValue={d.player.email} dir="ltr" /></Field>
            </div>
          </fieldset>
          <fieldset className="form-sec"><legend>وكيل اللاعب</legend>
            <label className="check"><input type="checkbox" name="hasAgent" defaultChecked={!!d.agent} /> بحضور وكيل اللاعب</label>
            <div className="form f3">
              <Field label="اسم الوكيل"><input name="aName" defaultValue={d.agent?.name} /></Field>
              <Field label="الجنسية"><input name="aNationality" defaultValue={d.agent?.nationality} /></Field>
              <Field label="رقم جواز السفر"><input name="aPassport" defaultValue={d.agent?.passportNo} dir="ltr" /></Field>
              <Field label="مكان الإصدار"><input name="aPassportPlace" defaultValue={d.agent?.passportPlace} /></Field>
              <Field label="تاريخ الإصدار"><input type="date" name="aPassportIssue" defaultValue={d.agent?.passportIssue} /></Field>
              <Field label="صلاحية الجواز"><input type="date" name="aPassportExpiry" defaultValue={d.agent?.passportExpiry} /></Field>
              <Field label="رقم بطاقة الوكيل المعتمد"><input name="aLicense" defaultValue={d.agent?.licenseNo} dir="ltr" /></Field>
              <Field label="الجهة المُصدرة للبطاقة"><input name="aLicenseIssuer" defaultValue={d.agent?.licenseIssuer} /></Field>
              <Field label="البطاقة صالحة حتى"><input type="date" name="aLicenseExpiry" defaultValue={d.agent?.licenseExpiry} /></Field>
            </div>
          </fieldset>
          <fieldset className="form-sec"><legend>المادة (2) — مدة العقد</legend>
            <div className="form f3">
              <Field label="مدة العقد (كتابة) *" hint="مثال: موسمان رياضيان / سنة واحدة"><input name="duration" defaultValue={d.duration} /></Field>
              <Field label="يبدأ في *"><input type="date" name="startDate" defaultValue={c.startDate} required /></Field>
              <Field label="نوع الانتهاء"><select name="termType" defaultValue={d.termType}>
                <option value="SEASON">بانتهاء موسم رياضي</option><option value="DATE">في تاريخ محدد</option></select></Field>
              <Field label="الموسم الذي ينتهي به" hint="للعقد المحدد بنهاية موسمية"><select name="endSeason" defaultValue={d.endSeason}>
                <option value="">—</option>{allSeasons.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
                {[...Array(4)].map((_, i) => { const y = new Date().getFullYear() + i; const n = `${y}/${y + 1}`; return allSeasons.some((s) => s.name === n) ? null : <option key={n} value={n}>{n}</option>; })}
              </select></Field>
              <Field label="ينتهي في *" hint="آخر يوم في العقد (أو نهاية الموسم)"><input type="date" name="endDate" defaultValue={c.endDate} required /></Field>
            </div>
          </fieldset>
          <fieldset className="form-sec"><legend>المادة (4) — المقابل المالي</legend>
            <div className="form f3">
              <Field label="العملة"><select name="currency" defaultValue={c.currency}><option value="LYD">دينار ليبي</option><option value="USD">دولار أمريكي</option><option value="EUR">يورو</option></select></Field>
              <Field label="القيمة الإجمالية لكامل المدة *"><input type="number" step="0.01" min="0" name="totalValue" defaultValue={c.totalValue ?? ""} /><W k="totalValue" /></Field>
              <Field label="مقدم العقد (إن وُجد)"><input type="number" step="0.01" min="0" name="signingBonus" defaultValue={c.signingBonus ?? ""} /><W k="signingBonus" /></Field>
              <Field label="الراتب الشهري *"><input type="number" step="0.01" min="0" name="monthlySalary" defaultValue={c.monthlySalary ?? ""} /><W k="monthlySalary" /></Field>
              <Field label="بدل السكن السنوي"><input type="number" step="0.01" min="0" name="housingAmount" defaultValue={c.housingAmount ?? ""} /><W k="housingAmount" /></Field>
              <Field label="بدل المواصلات"><input type="number" step="0.01" min="0" name="transportAmount" defaultValue={c.transportAmount ?? ""} /><W k="transportAmount" /></Field>
            </div>
            <p className="muted" style={{ fontSize: ".85rem" }}>يتحمل اللاعب 3% من إجمالي قيمة العقد لصالح الاتحاد يستقطعها النادي، وتُسجَّل على النادي مطالبةً مالية عند الاعتماد.</p>
            <Field label="ملحق العقد — امتيازات أو شروط أخرى متفق عليها (المادتان 5/10 و12)" full><textarea name="otherBenefits" rows={3} defaultValue={c.otherBenefits ?? ""} /></Field>
          </fieldset>
          <Submit>💾 حفظ بيانات العقد</Submit>
        </form>
      ) : (
        <EContractSummary c={c} words={words} playerName={name} clubName={u.clubName} />
      )}

      <div className="card">
        <h3>النسخة الموقّعة</h3>
        {c.signedFileKey ? <p><a href={fileUrl(c.signedFileKey)!} target="_blank">📎 عرض النسخة الموقّعة</a></p> : <p className="muted">لم تُرفع بعد.</p>}
        {editable && (
          <form action={uploadSignedContract} className="row">
            <input type="hidden" name="id" value={c.id} />
            <input type="file" name="file" accept="application/pdf,image/*" required />
            <Submit className="btn btn-light">⬆ {c.signedFileKey ? "استبدال" : "رفع"} النسخة الموقّعة</Submit>
          </form>
        )}
        {c.submittedAt && <p className="muted">أُرسل للاعتماد: {fmtDateTime(c.submittedAt)}</p>}
        {c.reviewedAt && <p className="muted">اعتُمد: {fmtDateTime(c.reviewedAt)}</p>}
      </div>

      {editable && u.can("club.submit") && (
        <div className="card">
          <h3>الإرسال إلى لجنة أوضاع اللاعبين وانتقالاتهم</h3>
          {miss.length > 0 ? <p className="danger-text">قبل الإرسال أكمل: {miss.join("، ")}</p> : <p className="muted">العقد مكتمل وجاهز للإرسال.</p>}
          <form action={submitContract}><input type="hidden" name="id" value={c.id} />
            <Submit className="btn btn-gold" confirm="إرسال العقد للاعتماد؟ لن تستطيع تعديله بعد الإرسال.">📤 إرسال العقد للاعتماد</Submit></form>
        </div>
      )}
    </>
  );
}
