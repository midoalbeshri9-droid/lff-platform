// قراءة ملفات Excel (xlsx) داخل المتصفح: القيم والصور المثبّتة على الخلايا — دون رفع الملف للخادم
import JSZip from "jszip";

export const CARD_RE = /^\d{6}[MF]\d{2}$/i;
export type SheetData = {
  name: string;
  cells: Map<number, Map<number, string>>; // صف (يبدأ من 1) ← عمود (يبدأ من 0) ← نص
  images: { row: number; media: string; blob: Blob }[];
  unsupported: { row: number; ext: string }[];
};

const byLocal = (root: Element | Document, name: string) => Array.from(root.getElementsByTagName("*")).filter((e) => e.localName === name);
const xml = async (zip: JSZip, path: string) => {
  const f = zip.file(path);
  return f ? new DOMParser().parseFromString(await f.async("text"), "application/xml") : null;
};
const resolve = (base: string, target: string) => {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const p of target.split("/")) p === ".." ? parts.pop() : p !== "." && parts.push(p);
  return parts.join("/");
};
const rels = async (zip: JSZip, path: string) => {
  const d = await xml(zip, path.replace(/([^/]+)$/, "_rels/$1.rels"));
  const m = new Map<string, { type: string; target: string }>();
  if (d) for (const r of byLocal(d, "Relationship")) m.set(r.getAttribute("Id")!, { type: r.getAttribute("Type") ?? "", target: resolve(path, r.getAttribute("Target") ?? "") });
  return m;
};
const attr = (el: Element, local: string) => Array.from(el.attributes).find((a) => a.localName === local)?.value ?? "";
const colIdx = (ref: string) => ref.replace(/\d+/g, "").split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

export async function readWorkbook(file: File): Promise<SheetData[]> {
  const zip = await JSZip.loadAsync(file);
  const ss = await xml(zip, "xl/sharedStrings.xml");
  const shared = ss ? byLocal(ss, "si").map((si) => byLocal(si, "t").map((t) => t.textContent ?? "").join("")) : [];
  const wb = await xml(zip, "xl/workbook.xml");
  const wbRels = await rels(zip, "xl/workbook.xml");
  const out: SheetData[] = [];
  for (const s of wb ? byLocal(wb, "sheet") : []) {
    const path = wbRels.get(attr(s, "id"))?.target;
    const doc = path ? await xml(zip, path) : null;
    if (!path || !doc) continue;
    const cells = new Map<number, Map<number, string>>();
    for (const c of byLocal(doc, "c")) {
      const ref = c.getAttribute("r") ?? "";
      const v = byLocal(c, "v")[0]?.textContent ?? byLocal(c, "t").map((x) => x.textContent).join("");
      const text = (c.getAttribute("t") === "s" ? shared[Number(v)] : v ?? "").toString().trim();
      if (!text) continue;
      const r = Number(ref.replace(/\D+/g, ""));
      if (!cells.has(r)) cells.set(r, new Map());
      cells.get(r)!.set(colIdx(ref), text);
    }
    const sheet: SheetData = { name: s.getAttribute("name") ?? "", cells, images: [], unsupported: [] };
    for (const dr of [...(await rels(zip, path)).values()].filter((r) => r.type.endsWith("/drawing"))) {
      const d = await xml(zip, dr.target);
      if (!d) continue;
      const dRels = await rels(zip, dr.target);
      for (const a of [...byLocal(d, "twoCellAnchor"), ...byLocal(d, "oneCellAnchor")]) {
        const from = byLocal(a, "from")[0], blip = byLocal(a, "blip")[0];
        if (!from || !blip) continue;
        const row = Number(byLocal(from, "row")[0]?.textContent ?? -1) + 1;
        const media = dRels.get(attr(blip, "embed"))?.target;
        if (!media || !zip.file(media)) continue;
        if (!/\.(png|jpe?g|gif|bmp|webp)$/i.test(media)) { sheet.unsupported.push({ row, ext: media.split(".").pop() ?? "" }); continue; }
        sheet.images.push({ row, media, blob: await zip.file(media)!.async("blob") });
      }
    }
    out.push(sheet);
  }
  return out;
}

/** أول صفوف الورقة: يبحث عن عمود عنوانه يطابق التعبير */
export function findCol(cells: SheetData["cells"], re: RegExp, maxRows = 10) {
  for (const [, m] of [...cells].slice(0, maxRows)) for (const [c, v] of m) if (re.test(v)) return c;
  return -1;
}
/** عمود رقم البطاقة: من العنوان، وإلا العمود الذي أغلب قيمه بشكل رقم البطاقة */
export function cardColumn(cells: SheetData["cells"]) {
  const c = findCol(cells, /player\s*id|رقم\s*البطاقة|البطاقة/i);
  if (c >= 0) return c;
  const count = new Map<number, number>();
  for (const [, m] of cells) for (const [k, v] of m) if (CARD_RE.test(v.replace(/\s+/g, ""))) count.set(k, (count.get(k) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1;
}

/** تصغير الصورة وتحويلها إلى JPEG (حجم أصغر وشكل موحد) */
export async function toJpeg(blob: Blob, maxDim = 600, quality = 0.9): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const s = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("jpeg"))), "image/jpeg", quality));
}

/** تاريخ الميلاد من خلية Excel: رقم تسلسلي أو نص بصيغ شائعة ← YYYY-MM-DD أو null */
export function parseDob(v: string | undefined): string | null {
  if (!v) return null;
  const t = v.trim();
  if (/^\d+(\.\d+)?$/.test(t) && Number(t) > 3000 && Number(t) < 60000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(t)) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = t.replace(/\s+/g, "").replace(/[\\.\-l]/g, "/").replace(/^(\d{1,2})\/(\d{2})(\d{4})$/, "$1/$2/$3");
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  let d: number, mo: number, y: number;
  if (m) [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/))) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else return null;
  if (mo > 12 && d <= 12) [d, mo] = [mo, d];
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y > 1950 && y < 2020)) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
/** سنة الميلاد من آخر رقمين في رقم البطاقة (000484M95 ← 1995) */
export function yearFromCard(card: string) {
  const m = card.match(/[MF](\d{2})$/i);
  if (!m) return null;
  const yy = Number(m[1]), now = new Date().getFullYear() % 100;
  return yy > now ? 1900 + yy : 2000 + yy;
}
const NAT: Record<string, string> = {
  "ليبيا": "ليبي", "Libya": "ليبي", "لييي": "ليبي", "Tunisia": "تونسي", "تونس": "تونسي", "السنغال": "سنغالي", "نيجيريا": "نيجيري", "Nigeria": "نيجيري",
  "مصر": "مصري", "المغرب": "مغربي", "Morocco": "مغربي", "الجزائر": "جزائري", "غانا": "غاني", "الكاميرون": "كاميروني", "السودان": "سوداني", "مالي": "مالي",
  "France": "فرنسي", "فرنسا": "فرنسي", "Spain": "إسباني", "إسبانيا": "إسباني", "اسبانيا": "إسباني", "س . العاج": "إيفواري", "ساحل العاج": "إيفواري",
};
export const normNat = (v: string | undefined) => { const t = (v ?? "").trim(); return !t || /^[=/]+$/.test(t) ? "ليبي" : NAT[t] ?? t; };
