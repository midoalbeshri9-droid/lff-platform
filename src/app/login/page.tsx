import { login } from "./actions";
import { Submit } from "@/components/Client";

export const metadata = { title: "تسجيل الدخول" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; m?: string; next?: string; ok?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="login-page">
      <header className="lff-header">
        <div className="lff-container hdr-row">
          <span className="brand">
            <img src="/img/logo-128.png" alt="شعار الاتحاد الليبي لكرة القدم" />
            <span>
              <span className="t1">الاتحاد الليبي لكرة القدم</span>
              <span className="t2">منظومة القيد والمسابقات والحكام</span>
            </span>
          </span>
        </div>
      </header>
      <div className="lff-flagbar" />
      <main className="login-main">
        <div className="login-card">
          <div className="logo">
            <img src="/img/logo-256.png" alt="" />
            <h3>تسجيل الدخول</h3>
            <p className="sub">للجان الاتحاد والأندية والحكام والمراقبين</p>
          </div>
          {sp.ok && <div className="alert ok">{sp.ok}</div>}
          {sp.error === "unverified" ? (
            <div className="alert warn">الحساب غير مفعّل بعد — افتح رسالة التفعيل التي وصلت إلى بريدك، أو تواصل مع مدير المنظومة لإعادة إرسالها.</div>
          ) : sp.error === "locked" ? (
            <div className="alert err">تم قفل الحساب مؤقتًا بسبب محاولات دخول فاشلة متكررة. حاول بعد {sp.m} دقيقة.</div>
          ) : sp.error ? (
            <div className="alert err">اسم المستخدم أو كلمة المرور غير صحيحة، أو الحساب معطّل.</div>
          ) : null}
          <form action={login}>
            <input type="hidden" name="next" value={sp.next ?? ""} />
            <div className="field">
              <label>اسم المستخدم</label>
              <input type="text" name="username" dir="ltr" autoComplete="username" required autoFocus />
            </div>
            <div className="field">
              <label>كلمة المرور</label>
              <input type="password" name="password" dir="ltr" autoComplete="current-password" required />
            </div>
            <Submit>دخول</Submit>
          </form>
          <p style={{ textAlign: "center", marginTop: ".8rem" }}><a href="/forgot">نسيت كلمة المرور؟</a></p>
          <hr />
          <p className="muted" style={{ fontSize: ".82rem", textAlign: "center", margin: 0 }}>
            يُقفل الحساب 15 دقيقة بعد 5 محاولات فاشلة.
          </p>
        </div>
      </main>
      <footer className="lff-footer">
        <div className="lff-container ftr-row">
          <span>© {new Date().getFullYear()} الاتحاد الليبي لكرة القدم</span>
        </div>
      </footer>
    </div>
  );
}
