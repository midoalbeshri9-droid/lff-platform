import Link from "next/link";
export default function Denied() {
  return (
    <div className="login-page">
      <main className="login-main">
        <div className="login-card" style={{ textAlign: "center" }}>
          <h3>⛔ لا تملك صلاحية الوصول</h3>
          <p className="muted">هذه الصفحة خارج صلاحيات حسابك. إن كنت تحتاجها، تواصل مع مدير المنظومة.</p>
          <Link className="btn btn-primary" href="/">العودة للرئيسية</Link>
        </div>
      </main>
    </div>
  );
}
