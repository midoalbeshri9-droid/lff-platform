import type { ReactNode } from "react";

/** إطار صفحات الدخول والتفعيل والاستعادة */
export function AuthShell({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="login-page">
      <header className="lff-header">
        <div className="lff-container hdr-row">
          <a className="brand" href="/login">
            <img src="/img/logo-128.png" alt="شعار الاتحاد الليبي لكرة القدم" />
            <span><span className="t1">الاتحاد الليبي لكرة القدم</span><span className="t2">منظومة القيد والمسابقات والحكام</span></span>
          </a>
        </div>
      </header>
      <div className="lff-flagbar" />
      <main className="login-main">
        <div className="login-card">
          <div className="logo"><img src="/img/logo-256.png" alt="" style={{ height: 90 }} /><h3>{title}</h3>{sub && <p className="sub">{sub}</p>}</div>
          {children}
        </div>
      </main>
    </div>
  );
}
