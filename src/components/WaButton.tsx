import { waLink, waShare } from "@/lib/whatsapp";

/** زر إرسال عبر واتساب (يفتح المحادثة والرسالة جاهزة) */
export function WaButton({ phone, text, label = "واتساب", share }: { phone?: string | null; text: string; label?: string; share?: boolean }) {
  const href = share ? waShare(text) : waLink(phone, text);
  if (!href) return <span className="muted" style={{ fontSize: ".78rem" }} title="لا يوجد رقم هاتف صالح">— لا رقم</span>;
  return <a className="btn btn-sm btn-wa" href={href} target="_blank" rel="noreferrer">🟢 {label}</a>;
}
