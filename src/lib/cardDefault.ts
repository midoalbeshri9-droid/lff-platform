import type { CardElement } from "@/db/schema";

// قالب افتراضي بمقاس CR80 (85.6 × 54 ملم) بهوية الاتحاد
export const DEFAULT_FRONT: CardElement[] = [
  { id: "hdr", kind: "rect", x: 0, y: 0, w: 85.6, h: 11, bg: "#1D1D1B" },
  { id: "bar", kind: "rect", x: 0, y: 11, w: 85.6, h: 1, bg: "#C9A23F" },
  { id: "logo", kind: "logo", x: 2, y: 1, w: 8, h: 9 },
  { id: "fed", kind: "field", field: "fedName", x: 12, y: 1.2, w: 71, h: 4.6, fontSize: 9, bold: true, color: "#ffffff", align: "right" },
  { id: "sub", kind: "text", text: "بطاقة قيد لاعب", x: 12, y: 5.8, w: 71, h: 4, fontSize: 7, color: "#C9A23F", align: "right" },
  { id: "photo", kind: "photo", x: 3, y: 14, w: 20, h: 25, radius: 1 },
  { id: "name", kind: "field", field: "fullName", x: 25, y: 14, w: 58, h: 5.5, fontSize: 9.5, bold: true, align: "right" },
  { id: "club", kind: "field", field: "club", x: 25, y: 20, w: 58, h: 4.5, fontSize: 8, color: "#3D6326", bold: true, align: "right" },
  { id: "num", kind: "field", field: "number", text: "رقم القيد:", x: 25, y: 25, w: 58, h: 4, fontSize: 7.5, align: "right" },
  { id: "cat", kind: "field", field: "category", text: "الفئة:", x: 25, y: 29.5, w: 58, h: 4, fontSize: 7.5, align: "right" },
  { id: "dob", kind: "field", field: "dob", text: "الميلاد:", x: 40, y: 34, w: 43, h: 4, fontSize: 7.5, align: "right" },
  { id: "qr", kind: "qr", x: 3, y: 40, w: 12.5, h: 12.5 },
  { id: "season", kind: "field", field: "season", text: "الموسم:", x: 40, y: 38.5, w: 43, h: 4, fontSize: 7.5, align: "right" },
  { id: "cardNo", kind: "field", field: "cardNo", text: "رقم البطاقة:", x: 40, y: 43, w: 43, h: 4, fontSize: 7.5, align: "right" },
  { id: "foot", kind: "rect", x: 0, y: 50.5, w: 85.6, h: 3.5, bg: "#4C7A30" },
  { id: "flag", kind: "rect", x: 0, y: 49.5, w: 85.6, h: 1, bg: "#A92222" },
];
