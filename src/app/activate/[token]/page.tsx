import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { peekToken, consumeToken } from "@/lib/tokens";
import { createSession, homeFor } from "@/lib/auth";
import { isClubRole, isOfficialRole } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { checkPassword, UserError } from "@/lib/util";
import { AuthShell } from "@/components/AuthShell";
import { Submit } from "@/components/Client";

export const dynamic = "force-dynamic";

export default async function Activate({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ err?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const t = await peekToken(token, "VERIFY");

  async function activate(f: FormData) {
    "use server";
    const tk = await peekToken(token, "VERIFY");
    if (!tk) redirect(`/activate/${token}`);
    let target = "";
    try {
      const pw = String(f.get("password") ?? ""), cf = String(f.get("confirm") ?? "");
      checkPassword(pw, cf);
      const ver = tk.u.sessionVersion + 1;
      await db.update(users).set({ passwordHash: await bcrypt.hash(pw, 10), isVerified: true, verifiedAt: new Date(), mustChangePassword: false, sessionVersion: ver, failedLogins: 0, lockedUntil: null }).where(eq(users.id, tk.u.id));
      await consumeToken(tk.t.id);
      await audit({ id: tk.u.id, fullName: tk.u.fullName }, "تفعيل الحساب", "User", tk.u.id);
      await createSession(tk.u.id, ver);
      target = homeFor({ isClub: isClubRole(tk.u.role), isOfficial: isOfficialRole(tk.u.role), mustChangePassword: false });
    } catch (e) {
      redirect(`/activate/${token}?err=${encodeURIComponent(e instanceof UserError ? e.message : "تعذّر التفعيل")}`);
    }
    redirect(target);
  }

  if (!t) {
    return (
      <AuthShell title="رابط غير صالح" sub="انتهت صلاحية رابط التفعيل أو استُخدم مسبقًا">
        <p className="muted" style={{ textAlign: "center" }}>اطلب من مدير المنظومة (أو مدير حساب النادي) إعادة إرسال رسالة التفعيل.</p>
        <a className="btn btn-primary" href="/login">صفحة الدخول</a>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="تفعيل الحساب" sub={`مرحبًا ${t.u.fullName} — اختر كلمة المرور لحسابك`}>
      {sp.err && <div className="alert err">{sp.err}</div>}
      <div className="alert info">اسم المستخدم: <strong className="kbd">{t.u.username}</strong></div>
      <form action={activate}>
        <div className="field"><label>كلمة المرور</label><input type="password" name="password" dir="ltr" required minLength={8} autoFocus /></div>
        <div className="field"><label>تأكيد كلمة المرور</label><input type="password" name="confirm" dir="ltr" required /></div>
        <p className="muted" style={{ fontSize: ".82rem" }}>8 أحرف على الأقل، تحتوي حروفًا وأرقامًا.</p>
        <Submit>تفعيل الحساب والدخول</Submit>
      </form>
    </AuthShell>
  );
}
