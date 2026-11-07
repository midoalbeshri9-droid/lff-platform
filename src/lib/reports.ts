import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { reportTemplates, type ReportField } from "@/db/schema";
import type { CurrentUser } from "./auth";
import { UserError } from "./util";

export type ReportKind = "REFEREE" | "COMMISSIONER";
export const REPORT_KIND: Record<ReportKind, string> = { REFEREE: "تقرير حكم المباراة", COMMISSIONER: "تقرير مراقب المباراة" };

/** تقارير الحكام والمراقبين سرية: للجنة المسابقات فقط (ومديري الدرجات لمسابقات درجتهم) */
export const canSeeReports = (u: CurrentUser) => u.canAny("comp.reports", "comp.reports.view");

// نموذج افتراضي يبدأ منه تصميم لجنة المسابقات (تعدّله أو تستبدله من صفحة «نماذج التقارير»)
const DEFAULTS: Record<ReportKind, { title: string; fields: ReportField[] }> = {
  REFEREE: {
    title: "تقرير حكم المباراة",
    fields: [
      { id: "s1", type: "section", label: "بيانات المباراة" },
      { id: "kickoff", type: "time", label: "وقت الانطلاق الفعلي", required: true },
      { id: "ht", type: "text", label: "نتيجة الشوط الأول", help: "مثال 1-0" },
      { id: "added1", type: "number", label: "الوقت بدل الضائع — الشوط الأول (دقائق)" },
      { id: "added2", type: "number", label: "الوقت بدل الضائع — الشوط الثاني (دقائق)" },
      { id: "s2", type: "section", label: "الملعب والتنظيم" },
      { id: "pitch", type: "select", label: "حالة أرضية الملعب", options: ["ممتازة", "جيدة", "مقبولة", "سيئة"] },
      { id: "security", type: "yesno", label: "توفر الأمن الكافي" },
      { id: "medical", type: "yesno", label: "توفر الإسعاف والطاقم الطبي" },
      { id: "s3", type: "section", label: "الحوادث" },
      { id: "sendoffs", type: "textarea", label: "تفاصيل حالات الطرد" },
      { id: "incidents", type: "textarea", label: "الشغب والحوادث والمخالفات (إن وجدت)" },
      { id: "notes", type: "textarea", label: "ملاحظات أخرى" },
    ],
  },
  COMMISSIONER: {
    title: "تقرير مراقب المباراة",
    fields: [
      { id: "s1", type: "section", label: "التوقيت والحضور" },
      { id: "kickoff", type: "time", label: "وقت الانطلاق الفعلي", required: true },
      { id: "attendance", type: "number", label: "الحضور الجماهيري التقريبي" },
      { id: "s2", type: "section", label: "الملعب والتنظيم" },
      { id: "pitch", type: "select", label: "حالة أرضية الملعب", options: ["ممتازة", "جيدة", "مقبولة", "سيئة"] },
      { id: "rooms", type: "rating", label: "غرف الملابس والمرافق" },
      { id: "organization", type: "textarea", label: "التنظيم (الإعلام، الإسعاف، الكرات، المنطقة الفنية...)" },
      { id: "s3", type: "section", label: "الأمن والانضباط" },
      { id: "security", type: "rating", label: "مستوى الأمن والتنظيم الأمني" },
      { id: "fans", type: "textarea", label: "سلوك الجماهير" },
      { id: "incidents", type: "textarea", label: "الحوادث والمخالفات" },
      { id: "s4", type: "section", label: "التوصيات" },
      { id: "recommendations", type: "textarea", label: "التوصيات", required: true },
    ],
  },
};

export async function getTemplate(kind: ReportKind) {
  const [t] = await db.select().from(reportTemplates).where(eq(reportTemplates.kind, kind));
  if (t) return t;
  const [n] = await db.insert(reportTemplates).values({ kind, ...DEFAULTS[kind] }).onConflictDoNothing().returning();
  return n ?? (await db.select().from(reportTemplates).where(eq(reportTemplates.kind, kind)))[0];
}

/** الإجابات من النموذج المرسل (الحقل f_<id>) */
export function answersFrom(f: FormData, fields: ReportField[]) {
  const a: Record<string, string> = {};
  for (const x of fields) {
    if (x.type === "section") continue;
    const v = String(f.get(`f_${x.id}`) ?? "").trim();
    if (v) a[x.id] = v.slice(0, 5000);
  }
  return a;
}
export function requireAnswers(fields: ReportField[], a: Record<string, string>) {
  const miss = fields.filter((x) => x.type !== "section" && x.required && !a[x.id]).map((x) => x.label);
  if (miss.length) throw new UserError(`أكمل الخانات الإلزامية: ${miss.join("، ")}`);
}

/** تنظيف خانات النموذج القادمة من المصمم */
export function cleanFields(raw: unknown): ReportField[] {
  if (!Array.isArray(raw)) throw new UserError("نموذج غير صالح");
  const types = new Set(["section", "text", "textarea", "number", "yesno", "select", "time", "date", "rating"]);
  const seen = new Set<string>();
  const out: ReportField[] = [];
  for (const r of raw.slice(0, 120) as Record<string, unknown>[]) {
    const type = String(r.type) as ReportField["type"];
    const label = String(r.label ?? "").trim().slice(0, 200);
    if (!types.has(type) || !label) continue;
    let id = String(r.id ?? "").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 40) || `f${out.length + 1}`;
    while (seen.has(id)) id = `${id}_`;
    seen.add(id);
    const options = type === "select" ? (Array.isArray(r.options) ? r.options : String(r.options ?? "").split(/\n|,|،/)).map((o) => String(o).trim()).filter(Boolean).slice(0, 40) : undefined;
    if (type === "select" && !options?.length) throw new UserError(`أضف خيارات للخانة «${label}»`);
    out.push({ id, type, label, required: type !== "section" && !!r.required, ...(options ? { options } : {}), ...(r.help ? { help: String(r.help).slice(0, 200) } : {}) });
  }
  if (!out.some((x) => x.type !== "section")) throw new UserError("أضف خانة واحدة على الأقل");
  return out;
}
