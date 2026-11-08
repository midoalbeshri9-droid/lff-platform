import Link from "next/link";

export const metadata = { title: { default: "الدوريات والمسابقات", template: "%s — الاتحاد الليبي لكرة القدم" } };
export const revalidate = 300; // تُحدَّث الصفحات العامة كل 5 دقائق

/** الموقع العام للمسابقات (بدون تسجيل دخول): الترتيب والنتائج والهدافون والقرارات الصادرة */
export default function LeagueLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="lg">
      <header className="lg-top">
        <div className="lg-in">
          <Link href="/league" className="lg-brand"><img src="/img/logo-256.png" alt="" /><div><strong>الاتحاد الليبي لكرة القدم</strong><small>المسابقات — النتائج والترتيب</small></div></Link>
          <Link href="/login" className="lg-login">دخول المنظومة</Link>
        </div>
        <div className="lg-flag" />
      </header>
      <main className="lg-in lg-main">{children}</main>
      <footer className="lg-foot"><div className="lg-in">© الاتحاد الليبي لكرة القدم — البيانات من منظومة لجنة تنظيم المسابقات وتُحدَّث تلقائيًا</div></footer>
    </div>
  );
}
