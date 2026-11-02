import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { peekToken, consumeToken } from "@/lib/tokens";
import { audit } from "@/lib/audit";
import { AuthShell } from "@/components/AuthShell";

export const dynamic = "force-dynamic";

export default async function ConfirmEmail({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await peekToken(token, "EMAIL_CHANGE");
  if (!t || !t.t.newEmail) return <AuthShell title="رابط غير صالح" sub="انتهت صلاحية الرابط أو استُخدم مسبقًا"><a className="btn btn-primary" href="/login">الدخول</a></AuthShell>;
  await db.update(users).set({ email: t.t.newEmail }).where(eq(users.id, t.u.id));
  await consumeToken(t.t.id);
  await audit({ id: t.u.id, fullName: t.u.fullName }, "تأكيد بريد جديد", "User", t.u.id, t.t.newEmail);
  return <AuthShell title="تم تأكيد البريد" sub={t.t.newEmail}><a className="btn btn-primary" href="/">المتابعة</a></AuthShell>;
}
