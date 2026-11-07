/** تحويل عدد صحيح إلى كلمات عربية (للمبالغ: «ألف وخمسمائة دينار») */
const ONES = ["", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة", "عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"];
const TENS = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
const HUNDREDS = ["", "مائة", "مائتان", "ثلاثمائة", "أربعمائة", "خمسمائة", "ستمائة", "سبعمائة", "ثمانمائة", "تسعمائة"];

function below1000(n: number): string {
  const h = Math.floor(n / 100), r = n % 100, parts: string[] = [];
  if (h) parts.push(HUNDREDS[h]);
  if (r) parts.push(r < 20 ? ONES[r] : (r % 10 ? `${ONES[r % 10]} و${TENS[Math.floor(r / 10)]}` : TENS[Math.floor(r / 10)]));
  return parts.join(" و");
}
function scale(n: number, one: string, two: string, few: string, many: string) {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${below1000(n)} ${few}`;
  return `${below1000(n)} ${many}`;
}
export function tafqeet(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return "صفر";
  const m = Math.floor(n / 1e6), t = Math.floor((n % 1e6) / 1000), r = n % 1000, parts: string[] = [];
  if (m) parts.push(scale(m, "مليون", "مليونان", "ملايين", "مليون"));
  if (t) parts.push(scale(t, "ألف", "ألفان", "آلاف", "ألف"));
  if (r) parts.push(below1000(r));
  return parts.join(" و");
}
/** «ألف وخمسمائة دينار» */
export const dinarsWords = (n: number) => {
  const w = tafqeet(n), x = Math.floor(n) % 100;
  return `${w} ${x >= 3 && x <= 10 && Math.floor(n) < 11 ? "دنانير" : "دينار"}`;
};
