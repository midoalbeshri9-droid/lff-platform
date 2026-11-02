import Link from "next/link";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { settings, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { mailConfig } from "@/lib/mail";
import { PageHead, Flash, Field, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { saveMailSettings, sendTestMail } from "../actions";

export default async function MailSettings({ searchParams }: { searchParams: SP }) {
  const u = await requireUser("admin.settings");
  const [me] = await db.select({ email: users.email }).from(users).where(eq(users.id, u.id));
  const sp = await searchParams;
  const rows = await db.select().from(settings).where(inArray(settings.key, ["smtp_host", "smtp_port", "smtp_user", "smtp_pass", "mail_from"]));
  const g = (k: string) => rows.find((r) => r.key === k)?.value ?? "";
  const cfg = await mailConfig();
  return (
    <>
      <PageHead title="إعدادات البريد (Gmail)" sub="لإرسال رسائل التفعيل واستعادة كلمة المرور والإشعارات للمستخدمين تلقائيًا"
        crumbs={[["الإدارة"], ["إعدادات البريد"]]} actions={<Link className="btn btn-light" href="/admin/outbox">✉ صندوق الرسائل</Link>} />
      <Flash sp={sp} />
      {cfg ? (
        <div className="alert ok">البريد مُفعّل — يُرسل من <span className="kbd">{cfg.user}</span>{cfg.source === "env" && " (من إعدادات الخادم SMTP_*، وتتقدم على هذه الصفحة)"}</div>
      ) : <div className="alert warn">البريد غير مُفعّل بعد — الرسائل تُحفظ في صندوق الرسائل وتُرسل روابطها يدويًا.</div>}

      <div className="grid g2">
        <form action={saveMailSettings} className="card form">
          <h3>حساب الإرسال</h3>
          <Field label="بريد Gmail المرسِل"><input type="email" name="smtp_user" dir="ltr" defaultValue={g("smtp_user")} placeholder="lff.system@gmail.com" /></Field>
          <Field label="كلمة مرور التطبيق (App Password)" hint={g("smtp_pass") ? "محفوظة ✓ — اتركها فارغة للإبقاء عليها" : "16 حرفًا من حساب Google — ليست كلمة مرور Gmail العادية"}>
            <input type="password" name="smtp_pass" dir="ltr" autoComplete="new-password" placeholder={g("smtp_pass") ? "••••••••••••••••" : "xxxx xxxx xxxx xxxx"} />
          </Field>
          <Field label="اسم المرسل الظاهر"><input type="text" name="mail_from" defaultValue={g("mail_from") || "الاتحاد الليبي لكرة القدم"} /></Field>
          <details>
            <summary className="muted">إعدادات متقدمة (لغير Gmail)</summary>
            <div className="form f2 mt">
              <Field label="خادم SMTP"><input type="text" name="smtp_host" dir="ltr" defaultValue={g("smtp_host") || "smtp.gmail.com"} /></Field>
              <Field label="المنفذ"><input type="number" name="smtp_port" dir="ltr" defaultValue={g("smtp_port") || "465"} /></Field>
            </div>
          </details>
          <div className="row">
            <Submit>💾 حفظ</Submit>
            {g("smtp_user") && <button name="clear" value="1" className="btn btn-ghost">إلغاء الربط</button>}
          </div>
        </form>

        <div>
          <form action={sendTestMail} className="card form">
            <h3>رسالة تجريبية</h3>
            <Field label="أرسل إلى"><input type="email" name="to" dir="ltr" defaultValue={me?.email ?? ""} required /></Field>
            {cfg ? <Submit className="btn btn-gold">📨 إرسال رسالة تجريبية</Submit> : <p className="muted">احفظ إعدادات الحساب أولًا</p>}
          </form>
          <div className="card">
            <h3>كيف أحصل على كلمة مرور التطبيق؟</h3>
            <ol style={{ lineHeight: 2, margin: 0, paddingInlineStart: "1.2rem" }}>
              <li>افتح حساب Gmail المخصص للمنظومة (يُفضّل بريد جديد للاتحاد).</li>
              <li>فعّل <strong>التحقق بخطوتين</strong> من <span className="kbd" dir="ltr">myaccount.google.com/security</span>.</li>
              <li>افتح <span className="kbd" dir="ltr">myaccount.google.com/apppasswords</span>، واكتب اسمًا مثل <em>LFF</em> ثم <strong>Create</strong>.</li>
              <li>انسخ الرمز المكون من 16 حرفًا والصقه في الخانة هنا ثم احفظ.</li>
              <li>اضغط «إرسال رسالة تجريبية» للتأكد.</li>
            </ol>
          </div>
        </div>
      </div>
    </>
  );
}
