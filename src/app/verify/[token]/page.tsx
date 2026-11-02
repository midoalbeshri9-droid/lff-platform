import { verifyByToken } from "@/lib/eligibility";
import { activeSuspensions } from "@/lib/registration";
import { REG_STATUS } from "@/lib/labels";
import { fmtDate, today } from "@/lib/util";

export const metadata = { title: "التحقق من بطاقة لاعب", robots: { index: false } };
export const dynamic = "force-dynamic";

/** صفحة عامة يفتحها رمز QR على البطاقة: تعرض حالة القيد الحالية دون بيانات حساسة */
export default async function Verify({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await verifyByToken(token);
  const susp = r ? await activeSuspensions(r.playerId) : [];
  const seasonOver = r ? r.season.endDate < today() : false;
  const valid = r && r.status === "APPROVED" && r.player.status === "ACTIVE" && susp.length === 0 && !seasonOver;
  return (
    <div className="login-page">
      <header className="lff-header"><div className="lff-container hdr-row"><span className="brand"><img src="/img/logo-128.png" alt="" /><span><span className="t1">الاتحاد الليبي لكرة القدم</span><span className="t2">التحقق من بطاقة قيد لاعب</span></span></span></div></header>
      <div className="lff-flagbar" />
      <main className="lff-container">
        <div className="verify">
          {!r ? (
            <div className="card"><div className="big bad">✗ بطاقة غير معروفة</div><p className="muted" style={{ textAlign: "center" }}>هذا الرمز غير مسجل في منظومة الاتحاد.</p></div>
          ) : (
            <div className="card" style={{ textAlign: "center" }}>
              <div className={`big ${valid ? "ok" : "bad"}`}>{valid ? "✓ قيد ساري" : "✗ غير مؤهل حاليًا"}</div>
              {r.player.photoKey && <img src={`/verify/${token}/photo`} alt="" className="photo-lg" style={{ margin: "1rem auto", display: "block" }} />}
              <h2>{r.player.fullName}</h2>
              <dl className="dl" style={{ textAlign: "start", marginTop: "1rem" }}>
                <dt>النادي</dt><dd>{r.club.name}</dd>
                <dt>رقم القيد</dt><dd className="kbd">{r.number}</dd>
                <dt>الموسم</dt><dd>{r.season.name}</dd>
                <dt>الفئة</dt><dd>{r.category?.name ?? "—"}</dd>
                <dt>حالة القيد</dt><dd>{REG_STATUS[r.status][0]}</dd>
                {seasonOver && (<><dt>ملاحظة</dt><dd className="danger-text">انتهى الموسم {fmtDate(r.season.endDate)}</dd></>)}
                {susp.length > 0 && (<><dt>الإيقاف</dt><dd className="danger-text">{susp.map((s) => s.kind === "ADMIN" ? "إيقاف إداري" : `موقوف ${(s.matchesTotal ?? 0) - s.matchesServed} مباراة`).join("، ")}</dd></>)}
                {r.player.status !== "ACTIVE" && (<><dt>حالة اللاعب</dt><dd className="danger-text">غير نشط</dd></>)}
              </dl>
              <p className="muted" style={{ fontSize: ".8rem", marginTop: "1rem" }}>تم التحقق بتاريخ {fmtDate(new Date())} — البيانات مباشرة من منظومة لجنة القيد</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
