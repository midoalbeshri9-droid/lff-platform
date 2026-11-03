import { redirect } from "next/navigation";

/** يحوّل مُدخل النموذج إلى نص مُشذّب أو null */
export const str = (f: FormData, k: string) => {
  const v = f.get(k);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
};
export const req = (f: FormData, k: string, label: string) => {
  const v = str(f, k);
  if (!v) throw new UserError(`الحقل "${label}" مطلوب`);
  return v;
};
export const int = (f: FormData, k: string) => {
  const v = str(f, k);
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
export const bool = (f: FormData, k: string) => f.get(k) === "on" || f.get(k) === "true" || f.get(k) === "1";
export const ints = (f: FormData, k: string) =>
  f.getAll(k).map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);

/** خطأ مخصص يظهر للمستخدم كما هو */
export class UserError extends Error {}

/** يعيد التوجيه مع رسالة نجاح أو خطأ تُعرض أعلى الصفحة */
export function back(path: string, msg: { ok?: string; err?: string }): never {
  // مسار داخلي فقط (يمنع التحويل إلى موقع خارجي عبر حقل «back» في النماذج)
  const u = new URL(/^\/(?![\/\\])/.test(path) ? path : "/", "http://x");
  if (u.host !== "x") redirect("/");
  u.searchParams.delete("ok");
  u.searchParams.delete("err");
  if (msg.ok) u.searchParams.set("ok", msg.ok);
  if (msg.err) u.searchParams.set("err", msg.err);
  redirect(u.pathname + u.search);
}

/** يغلّف إجراء الخادم: الأخطاء المعروفة ترجع للصفحة كرسالة */
export async function attempt(target: string | (() => string), fn: () => Promise<string | void>): Promise<never> {
  let ok: string | void;
  const p = () => (typeof target === "function" ? target() : target);
  try {
    ok = await fn();
  } catch (e: unknown) {
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: string }).digest).startsWith("NEXT_REDIRECT")) throw e;
    if (e instanceof UserError) back(p(), { err: e.message });
    const pg = e as { code?: string; detail?: string };
    if (pg?.code === "23505") back(p(), { err: "القيمة مسجلة مسبقًا (تكرار غير مسموح)" });
    if (pg?.code === "23503") back(p(), { err: "لا يمكن الحذف لارتباط السجل ببيانات أخرى" });
    console.error(e);
    back(p(), { err: "تعذّر تنفيذ العملية، حاول مجددًا" });
  }
  back(p(), { ok: ok || "تم الحفظ بنجاح" });
}

/** تاريخ اليوم بتوقيت ليبيا (YYYY-MM-DD) — لا بتوقيت الخادم UTC */
export const dayOf = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Africa/Tripoli" });
export const today = () => dayOf(new Date());

export function fmtDate(v: string | Date | null | undefined) {
  if (!v) return "—";
  const dt = typeof v === "string" ? new Date(v.length === 10 ? v + "T00:00:00" : v) : v;
  if (isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-GB", { timeZone: "Africa/Tripoli" });
}
export function fmtDateTime(v: string | Date | null | undefined) {
  if (!v) return "—";
  const dt = typeof v === "string" ? new Date(v) : v;
  return dt.toLocaleString("en-GB", { timeZone: "Africa/Tripoli", dateStyle: "short", timeStyle: "short" });
}
/** قيمة input type=datetime-local بتوقيت طرابلس */
export function toLocalInput(v: Date | null | undefined) {
  if (!v) return "";
  const t = new Date(v.getTime() + 2 * 3600_000);
  return t.toISOString().slice(0, 16);
}
export function fromLocalInput(s: string | null) {
  if (!s) return null;
  return new Date(s + ":00+02:00");
}

export function ageOn(dob: string, ref: string) {
  const b = new Date(dob), r = new Date(ref);
  let a = r.getFullYear() - b.getFullYear();
  const m = r.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && r.getDate() < b.getDate())) a--;
  return a;
}

/** رقم هاتف ليبي → 09XXXXXXXX */
export function normPhone(v: string | null) {
  if (!v) return null;
  const d = v.replace(/[\s\-()]/g, "").replace(/^\+?218/, "0").replace(/^00218/, "0");
  const x = d.startsWith("9") ? "0" + d : d;
  return /^09[1-6]\d{7}$/.test(x) ? x : null;
}
export function reqPhone(f: FormData, k = "phone") {
  const raw = str(f, k);
  if (!raw) throw new UserError("رقم الهاتف مطلوب");
  const p = normPhone(raw);
  if (!p) throw new UserError("رقم الهاتف غير صحيح (مثال: 0912345678)");
  return p;
}
export function reqEmail(f: FormData, k = "email") {
  const v = str(f, k)?.toLowerCase();
  if (!v) throw new UserError("البريد الإلكتروني مطلوب");
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(v)) throw new UserError("البريد الإلكتروني غير صحيح");
  return v;
}
export function checkPassword(nw: string, cf: string) {
  if (nw.length < 8 || !/[0-9]/.test(nw) || !/[A-Za-z؀-ۿ]/.test(nw)) throw new UserError("كلمة المرور: 8 أحرف على الأقل وتحتوي حروفًا وأرقامًا");
  if (nw !== cf) throw new UserError("تأكيد كلمة المرور غير مطابق");
}
export const money = (v: string | number | null | undefined) =>
  v == null || v === "" ? "—" : Number(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " د.ل";
export const num = (f: FormData, k: string) => {
  const v = str(f, k);
  if (v == null) return null;
  const n = Number(v.replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0) throw new UserError("قيمة رقمية غير صحيحة");
  return n.toFixed(2);
};
