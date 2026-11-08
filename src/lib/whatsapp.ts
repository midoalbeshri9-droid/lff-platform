// روابط واتساب جاهزة (wa.me) برسالة مكتوبة مسبقًا — لا تحتاج اشتراكًا؛ يفتحها الموظف من هاتفه أو واتساب ويب ويضغط إرسال
/** تحويل رقم ليبي محلي (09xxxxxxxx) أو دولي إلى صيغة واتساب (2189xxxxxxxx) */
export function waNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let d = phone.replace(/[^\d+]/g, "").replace(/^\+/, "").replace(/^00/, "");
  if (/^0\d{9}$/.test(d)) d = "218" + d.slice(1);
  else if (/^9\d{8}$/.test(d)) d = "218" + d;
  return /^\d{10,15}$/.test(d) ? d : null;
}
export function waLink(phone: string | null | undefined, text: string): string | null {
  const n = waNumber(phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}
/** رابط بلا رقم: يختار الموظف جهة الاتصال أو المجموعة بنفسه */
export const waShare = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
