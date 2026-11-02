import { db } from "@/db";
import { feeTypes, refereeRates } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/finance";
import { ASSIGN_ROLE_INPUT, OFFICIAL_GRADE, FEE_CODES } from "@/lib/labels";
import { money } from "@/lib/util";
import { PageHead, Flash, Field, Options, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { saveFee, saveRate, deleteRate, saveFinSettings } from "../actions";

export default async function FinSettings({ searchParams }: { searchParams: SP }) {
  await requireUser("fin.settings");
  const sp = await searchParams;
  const [fees, rates, s] = await Promise.all([db.select().from(feeTypes).orderBy(feeTypes.id), db.select().from(refereeRates).orderBy(refereeRates.role), getSettings()]);
  return (
    <>
      <PageHead title="إعدادات اللجنة المالية" sub="جدول الرسوم، أجور التحكيم، وقواعد التحصيل" />
      <Flash sp={sp} />
      <div className="card">
        <h2>جدول الرسوم</h2>
        <p className="muted">تُسجل تلقائيًا على النادي عند اعتماد القيد أو طباعة بطاقة بديلة. القيمة صفر = بلا رسوم.</p>
        <table className="t"><thead><tr><th>الرسم</th><th>القيمة</th><th>قيمة المحترف/تحت العقد</th><th>مفعّل</th><th></th></tr></thead>
          <tbody>{fees.map((f) => (
            <tr key={f.id}><td colSpan={5} style={{ padding: 0 }}>
              <form action={saveFee} className="row" style={{ padding: ".45rem .6rem" }}>
                <input type="hidden" name="id" value={f.id} />
                <span style={{ flex: 1 }}><strong>{FEE_CODES[f.code] ?? f.name}</strong></span>
                <input type="number" step="0.01" name="amount" defaultValue={f.amount} style={{ width: 120 }} />
                <input type="number" step="0.01" name="amountPro" defaultValue={f.amountPro ?? ""} placeholder="نفس القيمة" style={{ width: 140 }} />
                <label className="check"><input type="checkbox" name="isActive" defaultChecked={f.isActive} /> مفعّل</label>
                <Submit className="btn btn-sm btn-light">حفظ</Submit>
              </form>
            </td></tr>
          ))}</tbody></table>
      </div>
      <div className="card" id="rates">
        <h2>أجور التحكيم لكل مباراة</h2>
        <p className="muted">تُسجل لكل فرد من الطاقم عند اعتماد تقرير المباراة. أجر الدرجة المحددة يتقدم على الأجر العام للدور.</p>
        <table className="t"><thead><tr><th>الدور</th><th>الدرجة</th><th className="num">الأجر</th><th></th></tr></thead>
          <tbody>{rates.map((r) => (
            <tr key={r.id}><td>{ASSIGN_ROLE_INPUT[r.role] ?? r.role}</td><td>{r.grade ? OFFICIAL_GRADE[r.grade] : "كل الدرجات"}</td><td className="num">{money(r.amount)}</td>
              <td><form action={deleteRate}><input type="hidden" name="id" value={r.id} /><Submit className="btn btn-sm btn-ghost">حذف</Submit></form></td></tr>
          ))}</tbody></table>
        <form action={saveRate} className="row mt">
          <select name="role" style={{ width: "auto" }}><Options map={ASSIGN_ROLE_INPUT} /></select>
          <select name="grade" style={{ width: "auto" }}><option value="">كل الدرجات</option><Options map={OFFICIAL_GRADE} /></select>
          <input type="number" step="0.01" name="amount" placeholder="المبلغ" required style={{ width: 120 }} />
          <Submit className="btn btn-sm btn-primary">إضافة / تحديث</Submit>
        </form>
      </div>
      <form action={saveFinSettings} className="card form" style={{ maxWidth: 760 }}>
        <h2 className="full">قواعد التحصيل</h2>
        <Field label="منع النادي المتأخر من إرسال طلبات القيد" full><label className="check"><input type="checkbox" name="block_overdue" defaultChecked={s.block_overdue === "1"} /> مفعّل</label></Field>
        <Field label="يُعتبر المستحق متأخرًا بعد (يوم)"><input type="number" name="overdue_days" defaultValue={s.overdue_days ?? "30"} /></Field>
        <Field label="الحد الأدنى للمبلغ المتأخر لتطبيق المنع (د.ل)"><input type="number" step="0.01" name="block_overdue_min" defaultValue={s.block_overdue_min ?? "0"} /></Field>
        <div className="full"><Submit>حفظ</Submit></div>
      </form>
    </>
  );
}
