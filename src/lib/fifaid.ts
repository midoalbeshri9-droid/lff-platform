import "server-only";
/** أدوات المطابقة مع ملفات FIFA Connect المصدّرة */

export const cleanFifaId = (v: unknown) => {
  const s = String(v ?? "").trim().toUpperCase().replace(/\s+/g, "");
  return /^[A-Z0-9]{4,12}$/.test(s) ? s : null;
};

/** توحيد الاسم للمقارنة: عربي (أإآ→ا، ة→ه، ى→ي) ولاتيني (أحرف صغيرة) بلا مسافات ولا تشكيل */
export function normName(v: unknown) {
  return String(v ?? "")
    .normalize("NFKD").replace(/[̀-ًͯ-ْـ]/g, "")
    .replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
    .toLowerCase().replace(/\b(bin|ben|ibn|el|al)\b/g, "").replace(/^ال|\sال/g, " ")
    .replace(/[^a-zء-ي]/g, "");
}

/** تاريخ من خلية Excel (تاريخ أو نص dd/mm/yyyy أو yyyy-mm-dd) */
export function cellDate(v: unknown): string | null {
  if (v instanceof Date && !isNaN(+v)) return v.toISOString().slice(0, 10);
  const s = String(v ?? "").trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

export type Cols = { fifa: number; nid: number; pass: number; name: number; first: number; last: number; dob: number; club: number };

/** التعرف على الأعمدة من عناوينها (FIFA Connect يصدّر بالإنجليزية، وقد تكون عربية) */
export function detectCols(headers: string[]): Cols {
  const h = headers.map((x) => String(x ?? "").trim().toLowerCase());
  const find = (...res: RegExp[]) => h.findIndex((x) => res.some((r) => r.test(x)));
  return {
    fifa: find(/fifa.?id/, /connect.?id/, /رقم.*فيفا/, /^id fifa/),
    nid: find(/national.?id/, /الرقم الوطني/, /national.?number/, /identification/, /personal.?id/),
    pass: find(/passport/, /جواز/),
    name: find(/^full.?name/, /^name$/, /^الاسم/, /person.?name/),
    first: find(/first.?name/, /given.?name/, /الاسم الأول/),
    last: find(/last.?name/, /family.?name/, /surname/, /اللقب/),
    dob: find(/birth/, /dob/, /ميلاد/),
    club: find(/^club/, /organi[sz]ation/, /النادي/),
  };
}
