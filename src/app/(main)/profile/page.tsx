import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireUser, createSession, homeFor } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { attempt, UserError, reqEmail, reqPhone } from "@/lib/util";
import { ensureUniqueContact } from "@/lib/users";
import { createToken, appUrl } from "@/lib/tokens";
import { sendMail } from "@/lib/mail";
import { PageHead, Flash, Field, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { ROLE_LABEL } from "@/lib/labels";

async function changePassword(f: FormData) {
  "use server";
  const u = await requireUser();
  const cur = String(f.get("current") ?? ""), nw = String(f.get("new") ?? ""), cf = String(f.get("confirm") ?? "");
  let target = "";
  await attempt("/profile", async () => {
    const [row] = await db.select().from(users).where(eq(users.id, u.id));
    if (!(await bcrypt.compare(cur, row.passwordHash))) throw new UserError("كلمة المرور الحالية غير صحيحة");
    if (nw.length < 8 || !/[0-9]/.test(nw) || !/[A-Za-z؀-ۿ]/.test(nw)) throw new UserError("كلمة المرور الجديدة: 8 أحرف على الأقل وتحتوي حروفًا وأرقامًا");
    if (nw !== cf) throw new UserError("تأكيد كلمة المرور غير مطابق");
    const ver = row.sessionVersion + 1;
    await db.update(users).set({ passwordHash: await bcrypt.hash(nw, 10), mustChangePassword: false, sessionVersion: ver }).where(eq(users.id, u.id));
    await createSession(u.id, ver);
    await audit(u, "تغيير كلمة المرور", "User", u.id);
    if (u.mustChangePassword) target = homeFor({ ...u, mustChangePassword: false });
    return "تم تغيير كلمة المرور";
  }).catch((e) => {
    if (target) redirect(target);
    throw e;
  });
}

async function updateContact(f: FormData) {
  "use server";
  const u = await requireUser();
  await attempt("/profile", async () => {
    const [row] = await db.select().from(users).where(eq(users.id, u.id));
    const phone = reqPhone(f), email = u.role === "OBSERVER" && !f.get("email")?.toString().trim() ? null : reqEmail(f);
    await ensureUniqueContact(email, phone, u.id);
    const msgs: string[] = [];
    if (phone !== row.phone) {
      await db.update(users).set({ phone }).where(eq(users.id, u.id));
      msgs.push("تم تحديث رقم الهاتف");
    }
    if (email && email !== (row.email ?? "").toLowerCase()) {
      if (!row.email) {
        await db.update(users).set({ email }).where(eq(users.id, u.id));
        msgs.push("تم حفظ البريد");
      } else {
        const raw = await createToken(u.id, "EMAIL_CHANGE", 24, email);
        const r = await sendMail({ to: email, userId: u.id, subject: "تأكيد البريد الجديد", text: `مرحبًا ${row.fullName}، اضغط الرابط لتأكيد بريدك الجديد في المنظومة.`, link: `${appUrl()}/confirm-email/${raw}`, linkText: "تأكيد البريد" });
        msgs.push(r.sent ? "أُرسل رابط تأكيد إلى البريد الجديد — لن يتغير قبل التأكيد" : "البريد الجديد بانتظار التأكيد (رابط التأكيد في صندوق رسائل المدير)");
      }
    }
    await audit(u, "تحديث بيانات التواصل", "User", u.id);
    return msgs.join(" — ") || "لا تغييرات";
  });
}

export default async function Profile({ searchParams }: { searchParams: SP }) {
  const u = await requireUser();
  const sp = await searchParams;
  const [me] = await db.select().from(users).where(eq(users.id, u.id));
  return (
    <>
      <PageHead title="حسابي" sub={`${u.fullName} — ${ROLE_LABEL[u.role]}${u.clubName ? " — " + u.clubName : ""}`} />
      <Flash sp={sp} />
      {u.mustChangePassword && <div className="alert warn">يجب تغيير كلمة المرور المؤقتة قبل استخدام المنظومة.</div>}
      <div className="card" style={{ maxWidth: 560 }}>
        <h2>تغيير كلمة المرور</h2>
        <form action={changePassword} className="form f1">
          <Field label="كلمة المرور الحالية"><input type="password" name="current" dir="ltr" required /></Field>
          <Field label="كلمة المرور الجديدة" hint="8 أحرف على الأقل، حروف وأرقام"><input type="password" name="new" dir="ltr" required /></Field>
          <Field label="تأكيد كلمة المرور"><input type="password" name="confirm" dir="ltr" required /></Field>
          <div><Submit>حفظ</Submit></div>
        </form>
      </div>
      <div className="card" style={{ maxWidth: 560 }}>
        <h2>بيانات التواصل</h2>
        {((!me.email && u.role !== "OBSERVER") || !me.phone) && <div className="alert warn">يجب إدخال البريد الإلكتروني ورقم الهاتف لإكمال حسابك.</div>}
        <form action={updateContact} className="form f1">
          <Field label={u.role === "OBSERVER" ? "البريد الإلكتروني (اختياري)" : "البريد الإلكتروني"}><input type="email" name="email" dir="ltr" defaultValue={me.email ?? ""} required={u.role !== "OBSERVER"} placeholder="name@gmail.com" /></Field>
          <Field label="رقم الهاتف"><input type="tel" name="phone" dir="ltr" defaultValue={me.phone ?? ""} required placeholder="0912345678" /></Field>
          <div><Submit>حفظ</Submit></div>
        </form>
      </div>
      <dl className="dl card" style={{ maxWidth: 560 }}>
        <dt>اسم المستخدم</dt><dd className="kbd">{u.username}</dd>
        <dt>الدور</dt><dd>{ROLE_LABEL[u.role]}</dd>
        {u.clubName && (<><dt>النادي</dt><dd>{u.clubName}</dd></>)}
      </dl>
    </>
  );
}
