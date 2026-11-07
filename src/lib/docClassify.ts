// تصنيف ملفات اللاعب من أسمائها (يعمل في المتصفح) — يقترح النوع والمستخدم يؤكد أو يغيّر
export type DocTypeLite = { id: number; name: string };
const RULES: [RegExp, RegExp][] = [
  // [نمط في اسم الملف، نمط في اسم نوع المستند]
  [/passport|جواز|باسبور/i, /جواز/],
  [/\bitc\b|international\s*transfer|انتقال\s*دولي|الانتقال\s*الدولية/i, /ITC|الانتقال الدولية/],
  [/medical|طبي|طبى|كشف|فحص/i, /الكشف الطبي|طبي/],
  [/loan|اعار|إعار/i, /الإعارة|الاعارة/],
  [/contract|عقد/i, /عقد اللاعب|عقد/],
  [/birth|ميلاد/i, /الميلاد/],
  [/national\s*id|\bid\b|هوي|وطني|بطاقة\s*شخصية|رقم\s*وطني/i, /الهوية|الوطني/],
  [/clearance|release|مخالص|براء/i, /مخالصة/],
  [/guardian|parent|ولي\s*الامر|ولي\s*الأمر/i, /ولي الأمر/],
  [/\bform\b|استمار/i, /استمارة/],
  [/regulation|لائحة|لائحه/i, /لائحة|لائحه/],
];
const PHOTO = /photo|personal|portrait|صور|صوره|صورة|شخصي/i;

/** "photo" = الصورة الشخصية للاعب، وإلا رقم نوع المستند */
export function classify(fileName: string, mime: string, types: DocTypeLite[]): number | "photo" {
  const n = fileName.replace(/\.[a-z0-9]+$/i, "").replace(/[_\-.]+/g, " ");
  for (const [f, t] of RULES) if (f.test(n)) { const ty = types.find((x) => t.test(x.name)); if (ty) return ty.id; }
  if (mime.startsWith("image/") && PHOTO.test(n)) return "photo";
  return types.find((x) => /آخر|اخر/.test(x.name))?.id ?? types[types.length - 1]?.id ?? "photo";
}

const norm = (x: string) => x.toLowerCase().replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[ًٌٍَُِّْـ]/g, "").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
const bigrams = (s: string) => { const t = s.replace(/\s/g, ""); const out: string[] = []; for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2)); return out; };
function dice(a: string, b: string) {
  const A = bigrams(a), B = bigrams(b); if (!A.length || !B.length) return a === b ? 1 : 0;
  const m = new Map<string, number>(); for (const x of A) m.set(x, (m.get(x) ?? 0) + 1);
  let hit = 0; for (const x of B) { const c = m.get(x) ?? 0; if (c) { hit++; m.set(x, c - 1); } }
  return (2 * hit) / (A.length + B.length);
}
export type Dir = { id: number; name: string; nameEn: string | null; card: string | null; club: string | null };
/** مطابقة اسم المجلد بلاعب: رقم البطاقة أولًا، ثم أقرب اسم (يُعرض للتأكيد) */
export function matchFolder(folder: string, dir: Dir[]): { player: Dir; score: number } | null {
  const card = folder.toUpperCase().match(/\d{6}[MF]\d{2}/)?.[0];
  if (card) { const p = dir.find((x) => x.card === card); if (p) return { player: p, score: 1 }; }
  const f = norm(folder); if (!f) return null;
  let best: { player: Dir; score: number } | null = null;
  for (const p of dir) {
    for (const nm of [p.name, p.nameEn ?? ""]) {
      const n = norm(nm); if (!n) continue;
      const whole = dice(f, n);
      const tok = Math.max(0, ...n.split(" ").map((t) => dice(f, t)), ...f.split(" ").map((t) => dice(t, n.split(" ")[0] ?? "")));
      const sc = n.includes(f) || f.includes(n) ? 0.95 : Math.max(whole, tok * 0.9);
      if (!best || sc > best.score) best = { player: p, score: sc };
    }
  }
  return best && best.score >= 0.45 ? best : null;
}
