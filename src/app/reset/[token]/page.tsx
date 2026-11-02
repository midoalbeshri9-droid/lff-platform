import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { peekToken, consumeToken } from "@/lib/tokens";
import { audit } from "@/lib/audit";
import { checkPassword, UserError } from "@/lib/util";
import { AuthShell } from "@/components/AuthShell";
import { Submit } from "@/components/Client";

export const dynamic = "force-dynamic";

export default async function Reset({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ err?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const t = await peekToken(token, "RESET");

  async function reset(f: FormData) {
    "use server";
    const tk = await peekToken(token, "RESET");
    if (!tk) redirect(`/reset/${token}`);
    try {
      const pw = String(f.get("password") ?? ""), cf = String(f.get("confirm") ?? "");
      checkPassword(pw, cf);
      await db.update(users).set({ passwordHash: await bcrypt.hash(pw, 10), sessionVersion: tk.u.sessionVersion + 1, failedLogins: 0, lockedUntil: null, mustChangePassword: false }).where(eq(users.id, tk.u.id));
      await consumeToken(tk.t.id);
      await audit({ id: tk.u.id, fullName: tk.u.fullName }, "استعادة كلمة المرور", "User", tk.u.id);
    } catch (e) {
      redirect(`/reset/${token}?err=${encodeURIComponent(e instanceof UserError ? e.message : "تعذّر الحفظ")}`);
    }
    redirect("/login?ok=" + encodeURIComponent("تم تعيين كلمة المرور الجديدة — سجّل الدخول"));
  }

  if (!t) return (
    <AuthShell title="رابط غير صالح" sub="انتهت صلاحية الرابط أو استُخدم مسبقًا">
      <a className="btn btn-primary" href="/forgot">طلب رابط جديد</a>
    </AuthShell>
  );
  return (
    <AuthShell title="كلمة مرور جديدة" sub={t.u.fullName}>
      {sp.err && <div className="alert err">{sp.err}</div>}
      <form action={reset}>
        <div className="field"><label>كلمة المرور الجديدة</label><input type="password" name="password" dir="ltr" required minLength={8} autoFocus /></div>
        <div className="field"><label>تأكيد كلمة المرور</label><input type="password" name="confirm" dir="ltr" required /></div>
        <Submit>حفظ</Submit>
      </form>
    </AuthShell>
  );
}
