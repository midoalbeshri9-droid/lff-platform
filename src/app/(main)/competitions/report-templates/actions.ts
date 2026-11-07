"use server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { reportTemplates } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { cleanFields, getTemplate, type ReportKind } from "@/lib/reports";
import { attempt, req, UserError } from "@/lib/util";

/** حفظ نموذج تقرير الحكم أو المراقب (نموذج عام واحد لكل نوع) — التقارير السابقة تحتفظ بنسختها */
export async function saveReportTemplate(f: FormData) {
  const u = await requireUser("comp.manage");
  const kind = String(f.get("kind")) as ReportKind;
  await attempt(`/competitions/report-templates?kind=${kind}`, async () => {
    if (u.divisionId) throw new UserError("نماذج التقارير عامة — تعدّلها لجنة المسابقات بالاتحاد");
    if (kind !== "REFEREE" && kind !== "COMMISSIONER") throw new UserError("نوع غير صالح");
    let raw: unknown;
    try { raw = JSON.parse(String(f.get("fields") ?? "[]")); } catch { throw new UserError("نموذج غير صالح"); }
    const fields = cleanFields(raw);
    await getTemplate(kind);
    await db.update(reportTemplates).set({ title: req(f, "title", "عنوان النموذج"), fields, requireAttachment: f.get("requireAttachment") === "1", updatedAt: new Date(), updatedBy: u.fullName })
      .where(eq(reportTemplates.kind, kind));
    await audit(u, "تعديل نموذج تقرير", "ReportTemplate", null, { kind, fields: fields.length });
    return "تم حفظ النموذج — يظهر للحكام والمراقبين في التقارير الجديدة";
  });
}
