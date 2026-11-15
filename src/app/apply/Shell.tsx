import type { ReactNode } from "react";

export function ApplyShell({ children }: { children: ReactNode }) {
  return (
    <div className="login-page">
      <header className="lff-header">
        <div className="lff-container hdr-row">
          <a className="brand" href="/apply">
            <img src="/img/logo-128.png" alt="شعار الاتحاد الليبي لكرة القدم" />
            <span><span className="t1">الاتحاد الليبي لكرة القدم</span><span className="t2">التسجيل الذاتي للاعبين والحكام</span></span>
          </a>
        </div>
      </header>
      <div className="lff-flagbar" />
      <main className="lff-container" style={{ padding: "1.5rem 1rem", flex: 1, maxWidth: 900 }}>{children}</main>
      <footer className="lff-footer"><div className="lff-container ftr-row"><span>© {new Date().getFullYear()} الاتحاد الليبي لكرة القدم</span></div></footer>
    </div>
  );
}
