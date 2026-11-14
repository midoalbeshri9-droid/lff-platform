import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { waOutbox, clubs, users, officials } from "@/db/schema";
import { waNumber } from "./whatsapp";
import { appUrl } from "./tokens";

/** الإرسال التلقائي عبر WhatsApp Cloud API (Meta) — يعمل فقط إذا وُضعت المتغيرات في إعدادات الخادم */
export const waAuto = () => !!(process.env.WA_TOKEN && process.env.WA_PHONE_ID && process.env.WA_TEMPLATE);

async function sendCloud(to: string, text: string): Promise<string | null> {
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${process.env.WA_PHONE_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WA_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", to, type: "template",
        template: { name: process.env.WA_TEMPLATE, language: { code: process.env.WA_LANG ?? "ar" }, components: [{ type: "body", parameters: [{ type: "text", text: text.replace(/\n+/g, " — ").slice(0, 1000) }] }] },
      }),
    });
    if (r.ok) return null;
    return `HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`;
  } catch (e) { return (e as Error).message.slice(0, 200); }
}

/** نص الرسالة الموحد — بلا كلمات مرور ولا بيانات حساسة */
export function waText(title: string, body: string | null, link: string | null) {
  return [`*الاتحاد الليبي لكرة القدم*`, title, body, link ? `التفاصيل: ${appUrl()}${link}` : null].filter(Boolean).join("\n");
}

type Msg = { toName: string; phone: string | null };

/** يضيف رسائل لمن ضغط الزر الحالي (أو يرسلها تلقائيًا) — لا يفشل العملية الأصلية أبدًا */
export async function queueWa(targets: Msg[], text: string, q: Tx | typeof db = db) {
  try {
    if (!targets.length) return;
    const { getCurrentUser } = await import("./auth");
    const u = await getCurrentUser().catch(() => null);
    if (!u) return; // عمليات بلا مستخدم (سكربتات) لا تُنتج رسائل
    const seen = new Set<string>();
    for (const t of targets) {
      const n = waNumber(t.phone);
      const key = n ?? `x:${t.toName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!n) { await q.insert(waOutbox).values({ userId: u.id, toName: t.toName, phone: null, body: text, status: "NO_PHONE" }); continue; }
      if (waAuto()) {
        const err = await sendCloud(n, text);
        await q.insert(waOutbox).values({ userId: u.id, toName: t.toName, phone: n, body: text, status: err ? "FAILED" : "SENT", error: err, doneAt: err ? null : new Date() });
      } else await q.insert(waOutbox).values({ userId: u.id, toName: t.toName, phone: n, body: text });
    }
  } catch { /* الإشعار داخل المنظومة يكفي إن تعذّر تجهيز رسالة واتساب */ }
}

/** رقم النادي: هاتف النادي المسجّل، وإلا هاتف مدير حساب النادي */
export async function clubTargets(clubId: number, q: Tx | typeof db = db): Promise<Msg[]> {
  const [c] = await q.select({ name: clubs.name, phone: clubs.phone }).from(clubs).where(eq(clubs.id, clubId));
  if (!c) return [];
  if (waNumber(c.phone)) return [{ toName: c.name, phone: c.phone }];
  const [m] = await q.select({ phone: users.phone, name: users.fullName }).from(users)
    .where(and(eq(users.clubId, clubId), eq(users.isActive, true), inArray(users.role, ["CLUB_MANAGER", "CLUB_EMPLOYEE"]))).limit(1);
  return [{ toName: `${c.name}${m?.name ? ` (${m.name})` : ""}`, phone: m?.phone ?? null }];
}

export async function officialTargets(officialId: number, q: Tx | typeof db = db): Promise<Msg[]> {
  const [o] = await q.select({ name: officials.fullName, phone: officials.phone }).from(officials).where(eq(officials.id, officialId));
  if (!o) return [];
  if (waNumber(o.phone)) return [{ toName: o.name, phone: o.phone }];
  const [a] = await q.select({ phone: users.phone }).from(users).where(eq(users.officialId, officialId)).limit(1);
  return [{ toName: o.name, phone: a?.phone ?? null }];
}
