import { redirect } from "next/navigation";
import { readPending2fa } from "@/lib/auth";
import { Submit } from "@/components/Client";
import { verify2fa } from "../actions";

export const metadata = { title: "التحقق بخطوتين" };

export default async function TwoFactor({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  if (!(await readPending2fa())) redirect("/login?error=2fa-expired");
  return (
    <div className="login-page">
      <header className="lff-header">
        <div className="lff-container hdr-row">
          <span className="brand">
            <img src="/img/logo-128.png" alt="شعار الاتحاد الليبي لكرة القدم" />
            <span><span className="t1">الاتحاد الليبي لكرة القدم</span><span className="t2">منظومة القيد والمسابقات والحكام</span></span>
          </span>
        </div>
      </header>
      <div className="lff-flagbar" />
      <main className="login-main">
        <div className="login-card">
          <div className="logo">
            <img src="/img/logo-256.png" alt="" />
            <h3>🔐 التحقق بخطوتين</h3>
            <p className="sub">افتح تطبيق المصادقة على هاتفك وأدخل الرمز المكوّن من 6 أرقام</p>
          </div>
          {sp.error && <div className="alert err">الرمز غير صحيح أو انتهت صلاحيته — تأكد من ضبط ساعة الهاتف تلقائيًا وأعد المحاولة.</div>}
          <form action={verify2fa}>
            <div className="field">
              <label>رمز التحقق</label>
              <input type="text" name="code" dir="ltr" inputMode="numeric" autoComplete="one-time-code" required autoFocus maxLength={12}
                style={{ fontSize: "1.6rem", letterSpacing: ".4em", textAlign: "center" }} />
            </div>
            <Submit>تأكيد</Submit>
          </form>
          <hr />
          <p className="muted" style={{ fontSize: ".82rem", textAlign: "center", margin: 0 }}>
            فقدت هاتفك؟ أدخل أحد رموز الاسترداد (مثل <span dir="ltr">ABCD-EFGH</span>) بدل الرمز، أو تواصل مع مدير المنظومة.<br /><a href="/login">رجوع لتسجيل الدخول</a>
          </p>
        </div>
      </main>
    </div>
  );
}
