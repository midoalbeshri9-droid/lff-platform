import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getTemplate, REPORT_KIND, type ReportKind } from "@/lib/reports";
import { fmtDateTime } from "@/lib/util";
import { PageHead, Flash, type SP } from "@/components/ui";
import { ReportTemplateBuilder } from "@/components/ReportTemplateBuilder";
import { saveReportTemplate } from "./actions";

export default async function ReportTemplates({ searchParams }: { searchParams: SP }) {
  const u = await requireUser("comp.manage");
  const sp = await searchParams;
  const kind: ReportKind = sp.kind === "COMMISSIONER" ? "COMMISSIONER" : "REFEREE";
  const t = await getTemplate(kind);
  return (
    <>
      <PageHead title="نماذج تقارير الحكم والمراقب" sub="نموذج عام واحد لكل نوع تعدّه لجنة المسابقات — يعبّئه الحكم/المراقب في بوابته ويرفق التقرير الورقي، ويطّلع عليه أعضاء اللجنة فقط"
        crumbs={[["المسابقات", "/competitions"], ["نماذج التقارير"]]} />
      <Flash sp={sp} />
      <div className="tabs">{(Object.keys(REPORT_KIND) as ReportKind[]).map((k) => <Link key={k} href={`?kind=${k}`} className={`tab ${k === kind ? "active" : ""}`}>{REPORT_KIND[k]}</Link>)}</div>
      {t.updatedBy && <p className="muted" style={{ fontSize: ".85rem" }}>آخر تعديل: {t.updatedBy} — {fmtDateTime(t.updatedAt)}</p>}
      {kind === "COMMISSIONER" && <div className="alert info">يعبّئ المراقب الآن <strong>النموذج المعتمد لتقرير مراقب المباراة</strong> (النتائج، الإنذارات والطرد، الهدافون، التقييم الفني للطاقم، الملاحظات) ويُطبع بنفس الشكل الورقي. من هذه الصفحة يُضبط فقط خيار «إلزام إرفاق التقرير الورقي».</div>}
      {u.divisionId ? <div className="alert">النماذج عامة لكل الدرجات — تعدّلها لجنة المسابقات بالاتحاد.</div> : null}
      <ReportTemplateBuilder key={kind + t.updatedAt.toISOString()} kind={kind} title={t.title} fields={t.fields} requireAttachment={t.requireAttachment} action={saveReportTemplate} />
    </>
  );
}
