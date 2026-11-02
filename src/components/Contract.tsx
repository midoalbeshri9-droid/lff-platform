import type { contracts } from "@/db/schema";
import { fmtDate, money } from "@/lib/util";
import { Field } from "./ui";
import { Submit } from "./Client";

type C = typeof contracts.$inferSelect;

const months = (a: string, b: string) => {
  const s = new Date(a), e = new Date(b);
  return Math.max(0, (e.getFullYear() - s.getFullYear()) * 12 + e.getMonth() - s.getMonth() + (e.getDate() >= s.getDate() ? 0 : -1));
};
const STATUS: Record<string, [string, string]> = { ACTIVE: ["ساري", "b-green"], TERMINATED: ["منتهٍ بانتقال/فسخ", "b-gray"], EXPIRED: ["منتهٍ", "b-gray"] };

/** عرض العقد — القيم المالية تظهر فقط لمن يحق له */
export function ContractView({ c, showMoney }: { c: C | null; showMoney: boolean }) {
  if (!c) return <p className="muted">لم تُدخل بيانات العقد.</p>;
  const left = Math.ceil((new Date(c.endDate).getTime() - Date.now()) / 864e5);
  return (
    <>
      <div className="row" style={{ marginBottom: ".5rem" }}>
        <span className={`b ${STATUS[c.status][1]}`}>{STATUS[c.status][0]}</span>
        {c.status === "ACTIVE" && left <= 60 && left >= 0 && <span className="b b-amber">ينتهي خلال {left} يومًا</span>}
        {c.status === "ACTIVE" && left < 0 && <span className="b b-red">منتهي المدة</span>}
      </div>
      <dl className="dl">
        <dt>المدة</dt><dd>{fmtDate(c.startDate)} ← {fmtDate(c.endDate)} ({months(c.startDate, c.endDate)} شهرًا)</dd>
        {showMoney ? (
          <>
            <dt>القيمة الإجمالية</dt><dd>{money(c.totalValue)}</dd>
            <dt>الراتب الشهري</dt><dd>{money(c.monthlySalary)}</dd>
            <dt>مقدّم التوقيع</dt><dd>{money(c.signingBonus)}</dd>
            <dt>شرط الفسخ</dt><dd>{money(c.releaseClause)}</dd>
            {c.bonuses && (<><dt>المكافآت والحوافز</dt><dd>{c.bonuses}</dd></>)}
            <dt>المزايا</dt><dd>{[c.housing && "سكن", c.transport && "مواصلات", c.otherBenefits].filter(Boolean).join("، ") || "—"}</dd>
          </>
        ) : (<><dt>القيم المالية</dt><dd className="muted">سرية — تظهر للجنة القيد والنادي فقط</dd></>)}
        {c.renewalOption && (<><dt>بند التجديد</dt><dd>{c.renewalOption}</dd></>)}
        {c.notes && (<><dt>ملاحظات</dt><dd>{c.notes}</dd></>)}
        {c.terminationReason && (<><dt>سبب الانتهاء</dt><dd>{c.terminationReason}</dd></>)}
      </dl>
    </>
  );
}

export function ContractForm({ c, regId, action }: { c: C | null; regId: number; action: (f: FormData) => Promise<void> }) {
  return (
    <form action={action} className="form f3">
      <input type="hidden" name="id" value={regId} />
      <Field label="بداية العقد *"><input type="date" name="startDate" defaultValue={c?.startDate ?? ""} required /></Field>
      <Field label="نهاية العقد *"><input type="date" name="endDate" defaultValue={c?.endDate ?? ""} required /></Field>
      <Field label="العملة"><select name="currency" defaultValue={c?.currency ?? "LYD"}><option value="LYD">دينار ليبي</option><option value="USD">دولار</option><option value="EUR">يورو</option></select></Field>
      <Field label="القيمة الإجمالية للعقد"><input type="number" step="0.01" name="totalValue" defaultValue={c?.totalValue ?? ""} /></Field>
      <Field label="الراتب الشهري"><input type="number" step="0.01" name="monthlySalary" defaultValue={c?.monthlySalary ?? ""} /></Field>
      <Field label="مقدّم التوقيع"><input type="number" step="0.01" name="signingBonus" defaultValue={c?.signingBonus ?? ""} /></Field>
      <Field label="قيمة شرط الفسخ"><input type="number" step="0.01" name="releaseClause" defaultValue={c?.releaseClause ?? ""} /></Field>
      <Field label="المزايا">
        <label className="check"><input type="checkbox" name="housing" defaultChecked={c?.housing} /> سكن</label>
        <label className="check"><input type="checkbox" name="transport" defaultChecked={c?.transport} /> مواصلات</label>
      </Field>
      <Field label="مزايا أخرى"><input type="text" name="otherBenefits" defaultValue={c?.otherBenefits ?? ""} /></Field>
      <Field label="المكافآت والحوافز" full><textarea name="bonuses" defaultValue={c?.bonuses ?? ""} placeholder="مكافأة الفوز، الأهداف، البطولات..." /></Field>
      <Field label="بند التجديد"><input type="text" name="renewalOption" defaultValue={c?.renewalOption ?? ""} placeholder="مثال: تجديد تلقائي لموسم بموافقة الطرفين" /></Field>
      <Field label="ملاحظات" full><textarea name="contractNotes" defaultValue={c?.notes ?? ""} /></Field>
      <div className="full"><Submit className="btn btn-gold">💾 حفظ بيانات العقد</Submit></div>
      <p className="muted full" style={{ fontSize: ".8rem", margin: 0 }}>ارفع نسخة العقد الموقّعة من قسم المستندات. القيم المالية سرية: تظهر لناديكم وللجنة القيد فقط.</p>
    </form>
  );
}
