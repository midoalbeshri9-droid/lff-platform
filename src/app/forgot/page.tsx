import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { sendReset } from "@/lib/tokens";
import { AuthShell } from "@/components/AuthShell";
import { Submit } from "@/components/Client";

export const metadata = { title: "نسيت كلمة المرور" };

async function request(f: FormData) {
  "use server";
  const email = String(f.get("email") ?? "").trim().toLowerCase();
  if (email) {
    const [u] = await db.select().from(users).where(and(eq(sql`lower(${users.email})`, email), eq(users.isActive, true), eq(users.isVerified, true))).limit(1);
    if (u) await sendReset(u);
  }
  // نفس الرسالة دائمًا كي لا يُعرف إن كان البريد مسجلًا
  redirect("/login?ok=" + encodeURIComponent("إذا كان البريد مسجلًا ستصلك رسالة فيها رابط تعيين كلمة مرور جديدة."));
}

export default function Forgot() {
  return (
    <AuthShell title="نسيت كلمة المرور" sub="أدخل البريد المسجل في حسابك">
      <form action={request}>
        <div className="field"><label>البريد الإلكتروني</label><input type="email" name="email" dir="ltr" required autoFocus placeholder="name@gmail.com" /></div>
        <Submit>إرسال رابط الاستعادة</Submit>
      </form>
      <p className="muted" style={{ textAlign: "center", marginTop: "1rem", fontSize: ".85rem" }}>مراقبو المباريات بدون بريد: تواصلوا مع لجنة المسابقات لتعيين كلمة مرور جديدة.</p>
      <p style={{ textAlign: "center", marginTop: "1rem" }}><a href="/login">العودة لتسجيل الدخول</a></p>
    </AuthShell>
  );
}
