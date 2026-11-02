import "server-only";
import nodemailer from "nodemailer";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { outbox, settings } from "@/db/schema";

// البريد عبر SMTP (Gmail بكلمة مرور تطبيق، أو أي مزود).
// المصدر: متغيرات البيئة (SMTP_*) إن وُجدت، وإلا «إعدادات البريد» المحفوظة من صفحة الإدارة.
// إن لم يُضبط تُحفظ الرسالة في صندوق الرسائل ليرسلها المدير يدويًا.
export type MailConfig = { host: string; port: number; user: string; pass: string; from: string; source: "env" | "db" };

export async function mailConfig(): Promise<MailConfig | null> {
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return { host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? 465), user: process.env.SMTP_USER, pass: process.env.SMTP_PASS, from: process.env.MAIL_FROM || process.env.SMTP_USER, source: "env" };
  }
  const rows = await db.select().from(settings).where(inArray(settings.key, ["smtp_host", "smtp_port", "smtp_user", "smtp_pass", "mail_from"]));
  const g = (k: string) => rows.find((r) => r.key === k)?.value?.trim() ?? "";
  if (!g("smtp_user") || !g("smtp_pass")) return null;
  const user = g("smtp_user");
  return { host: g("smtp_host") || "smtp.gmail.com", port: Number(g("smtp_port") || 465), user, pass: g("smtp_pass").replace(/\s+/g, ""), from: g("mail_from") ? `${g("mail_from")} <${user}>` : user, source: "db" };
}

export const mailConfigured = async () => !!(await mailConfig());

function transport(c: MailConfig) {
  return nodemailer.createTransport({ host: c.host, port: c.port, secure: c.port === 465, auth: { user: c.user, pass: c.pass } });
}

/** فحص الاتصال بخادم البريد وإرسال رسالة تجريبية */
export async function testMail(to: string) {
  const c = await mailConfig();
  if (!c) throw new Error("البريد غير مُعدّ");
  await transport(c).verify();
  return sendMail({ to, subject: "رسالة تجريبية من منظومة الاتحاد", text: "تم ضبط البريد بنجاح — ستصل رسائل التفعيل واستعادة كلمة المرور للمستخدمين تلقائيًا." });
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function layout(title: string, body: string, link?: string, linkText?: string) {
  return `<!doctype html><html dir="rtl" lang="ar"><body style="margin:0;background:#F6F5F1;font-family:Tahoma,Arial,sans-serif">
  <div style="max-width:560px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;border-top:4px solid #C9A23F">
    <div style="background:#1D1D1B;color:#fff;padding:16px 20px;font-weight:bold">الاتحاد الليبي لكرة القدم<div style="color:#C9A23F;font-size:12px;font-weight:normal">منظومة القيد والمسابقات والحكام</div></div>
    <div style="padding:22px 20px;color:#1D1D1B;line-height:1.9">
      <h2 style="margin:0 0 12px;font-size:18px">${esc(title)}</h2>
      <div>${body}</div>
      ${link ? `<p style="text-align:center;margin:26px 0"><a href="${link}" style="background:#4C7A30;color:#fff;padding:12px 26px;border-radius:8px;text-decoration:none;font-weight:bold">${esc(linkText ?? "فتح")}</a></p>
      <p style="font-size:12px;color:#7b7a74;direction:ltr;text-align:left;word-break:break-all">${link}</p>` : ""}
    </div>
    <div style="background:#f4f2ec;color:#7b7a74;font-size:12px;padding:10px 20px">رسالة آلية — لا ترد عليها.</div>
  </div></body></html>`;
}

export async function sendMail(opts: { to: string; subject: string; text: string; link?: string; linkText?: string; userId?: number }) {
  const [row] = await db.insert(outbox).values({ channel: "EMAIL", to: opts.to, subject: opts.subject, body: opts.text, link: opts.link ?? null, userId: opts.userId ?? null }).returning();
  const cfg = await mailConfig();
  if (!cfg) {
    await db.update(outbox).set({ status: "NOT_CONFIGURED" }).where(eq(outbox.id, row.id));
    return { sent: false, id: row.id };
  }
  try {
    await transport(cfg).sendMail({
      from: cfg.from,
      to: opts.to,
      subject: opts.subject,
      text: `${opts.text}${opts.link ? "\n\n" + opts.link : ""}`,
      html: layout(opts.subject, esc(opts.text).replace(/\n/g, "<br>"), opts.link, opts.linkText),
    });
    await db.update(outbox).set({ status: "SENT", sentAt: new Date() }).where(eq(outbox.id, row.id));
    return { sent: true, id: row.id };
  } catch (e) {
    await db.update(outbox).set({ status: "FAILED", error: String((e as Error).message).slice(0, 500) }).where(eq(outbox.id, row.id));
    return { sent: false, id: row.id, error: String((e as Error).message) };
  }
}

/** رسائل SMS — جاهزة للربط بمزود ليبي (SMS_PROVIDER_URL + SMS_API_KEY). حتى ذلك تُحفظ في الصندوق فقط */
export async function sendSms(to: string, text: string, userId?: number) {
  const [row] = await db.insert(outbox).values({ channel: "SMS", to, body: text, userId: userId ?? null }).returning();
  const url = process.env.SMS_PROVIDER_URL;
  if (!url) {
    await db.update(outbox).set({ status: "NOT_CONFIGURED" }).where(eq(outbox.id, row.id));
    return { sent: false };
  }
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.SMS_API_KEY ?? ""}` },
      body: JSON.stringify({ to, message: text, sender: process.env.SMS_SENDER ?? "LFF" }),
    });
    await db.update(outbox).set({ status: r.ok ? "SENT" : "FAILED", sentAt: new Date(), error: r.ok ? null : `HTTP ${r.status}` }).where(eq(outbox.id, row.id));
    return { sent: r.ok };
  } catch (e) {
    await db.update(outbox).set({ status: "FAILED", error: String((e as Error).message).slice(0, 500) }).where(eq(outbox.id, row.id));
    return { sent: false };
  }
}
