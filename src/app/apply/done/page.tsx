import { ApplyShell } from "../Shell";

export const metadata = { title: "تم إرسال الطلب" };

export default async function Done({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const { ref } = await searchParams;
  return (
    <ApplyShell>
      <div className="card" style={{ textAlign: "center" }}>
        <h2>✅ تم إرسال طلبك</h2>
        <p>رقم الطلب: <strong dir="ltr" style={{ fontSize: "1.3rem" }}>{(ref ?? "").replace(/[^A-Z0-9-]/g, "")}</strong></p>
        <p className="muted">احتفظ بهذا الرقم. ستتواصل معك الجهة المختصة على رقم هاتفك بعد مراجعة الطلب، وقد يُطلب منك الحضور بالمستندات الأصلية.</p>
        <a className="btn btn-light" href="/apply">طلب جديد</a>
      </div>
    </ApplyShell>
  );
}
