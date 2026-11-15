import QRCode from "qrcode";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { openSecret, otpauthUrl, formatSecret, required2faRoles } from "@/lib/totp";
import { PageHead, Flash, Field, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { start2fa, enable2fa, regenBackup, disable2fa, hideCodes } from "./actions";

export const metadata = { title: "التحقق بخطوتين" };

export default async function TwoFA({ searchParams }: { searchParams: SP }) {
  const u = await requireUser();
  const sp = await searchParams;
  const [x] = await db.select().from(users).where(eq(users.id, u.id));
  const required = (await required2faRoles()).includes(u.role);
  const codes = (await cookies()).get("lff_bk")?.value?.split(",").filter(Boolean) ?? [];
  const secret = !x.totpEnabled && x.totpSecret ? openSecret(x.totpSecret) : null;
  const qr = secret ? await QRCode.toDataURL(otpauthUrl(secret, x.username), { margin: 1, width: 220 }) : null;
  return (
    <>
      <PageHead title="🔐 التحقق بخطوتين" sub="حماية إضافية: بعد كلمة المرور يُطلب رمز يتغير كل 30 ثانية من تطبيق على هاتفك — فلا يكفي معرفة كلمة المرور للدخول" crumbs={[["حسابي", "/profile"], ["التحقق بخطوتين"]]} />
      <Flash sp={sp} />
      {required && !x.totpEnabled && <div className="alert warn"><strong>مطلوب لدورك:</strong> لا يمكنك استخدام المنظومة قبل تفعيل التحقق بخطوتين. يستغرق دقيقة واحدة.</div>}

      {codes.length > 0 && (
        <div className="card" style={{ borderInlineStart: "4px solid var(--gold, #c9a227)" }}>
          <h2>🗝 رموز الاسترداد — احفظها الآن</h2>
          <p>كل رمز يُستخدم مرة واحدة للدخول إذا فقدت هاتفك. <strong>لن تظهر مرة أخرى.</strong> اطبعها أو انسخها واحفظها في مكان آمن بعيدًا عن الهاتف.</p>
          <div className="grid g4" dir="ltr" style={{ fontFamily: "monospace", fontSize: "1.15rem", gap: ".5rem" }}>{codes.map((c) => <div key={c} className="kbd" style={{ textAlign: "center", padding: ".5rem" }}>{c}</div>)}</div>
          <form action={hideCodes} className="mt"><Submit className="btn btn-primary">✓ حفظتها</Submit></form>
        </div>
      )}

      {x.totpEnabled ? (
        <div className="grid g2">
          <div className="card">
            <h2>الحالة: <span className="b b-green">مفعّل ✓</span></h2>
            <p>رموز الاسترداد المتبقية: <strong>{x.totpBackup?.length ?? 0}</strong> من 8</p>
            <form action={regenBackup} className="form f1">
              <Field label="رمز التطبيق الحالي"><input type="text" name="code" inputMode="numeric" dir="ltr" required maxLength={6} /></Field>
              <Submit className="btn btn-light">إصدار رموز استرداد جديدة</Submit>
            </form>
          </div>
          {!required && (
            <div className="card">
              <h2>إيقاف التحقق بخطوتين</h2>
              <p className="muted">غير مستحسن — يجعل حسابك محميًا بكلمة المرور فقط.</p>
              <form action={disable2fa} className="form f1">
                <Field label="رمز التطبيق الحالي"><input type="text" name="code" inputMode="numeric" dir="ltr" required maxLength={6} /></Field>
                <Submit className="btn btn-danger" confirm="إيقاف التحقق بخطوتين؟">إيقاف</Submit>
              </form>
            </div>
          )}
        </div>
      ) : !secret ? (
        <div className="card">
          <h2>الحالة: <span className="b b-gray">غير مفعّل</span></h2>
          <ol>
            <li>ثبّت على هاتفك تطبيق <strong>Google Authenticator</strong> أو <strong>Microsoft Authenticator</strong> (مجاني).</li>
            <li>اضغط «بدء التفعيل» وامسح الرمز المربع بالتطبيق.</li>
            <li>أدخل الرمز الذي يظهر في التطبيق لتأكيد الربط.</li>
          </ol>
          <form action={start2fa}><Submit>بدء التفعيل</Submit></form>
        </div>
      ) : (
        <div className="card">
          <h2>امسح الرمز بتطبيق المصادقة</h2>
          <div className="row" style={{ gap: "1.5rem", alignItems: "flex-start", flexWrap: "wrap" }}>
            {qr && <img src={qr} alt="رمز الربط" width={220} height={220} style={{ background: "#fff", padding: 6, borderRadius: 8 }} />}
            <div style={{ flex: 1, minWidth: 240 }}>
              <p>لا تستطيع المسح؟ أدخل هذا المفتاح يدويًا في التطبيق (نوع: حسب الوقت):</p>
              <p className="kbd" dir="ltr" style={{ fontSize: "1.05rem", wordBreak: "break-all" }}>{formatSecret(secret)}</p>
              <form action={enable2fa} className="form f1 mt">
                <Field label="الرمز الظاهر في التطبيق (6 أرقام)"><input type="text" name="code" inputMode="numeric" dir="ltr" autoComplete="one-time-code" required maxLength={6} autoFocus style={{ fontSize: "1.4rem", letterSpacing: ".3em", textAlign: "center" }} /></Field>
                <Submit>تأكيد وتفعيل</Submit>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
