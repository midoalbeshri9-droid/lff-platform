import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { matchReportForms, reportFiles, officials } from "@/db/schema";
import { fileUrl } from "@/lib/storage";
import { fmtDateTime } from "@/lib/util";
import { REPORT_KIND, type ReportKind } from "@/lib/reports";
import { ReportAnswers } from "./ReportFields";

/** عرض تقرير الحكم أو المراقب (خانات النموذج + المرفقات) — للجنة المسابقات فقط */
export async function MatchReportView({ matchId, kind, legacy }: { matchId: number; kind: ReportKind; legacy?: React.ReactNode }) {
  const [form] = await db.select({ f: matchReportForms, name: officials.fullName }).from(matchReportForms)
    .leftJoin(officials, eq(officials.id, matchReportForms.officialId))
    .where(and(eq(matchReportForms.matchId, matchId), eq(matchReportForms.kind, kind)));
  const files = await db.select().from(reportFiles).where(and(eq(reportFiles.matchId, matchId), eq(reportFiles.kind, kind))).orderBy(reportFiles.uploadedAt);
  const has = form?.f.isSubmitted || files.length > 0 || !!legacy;
  return (
    <div className="card">
      <div className="card-head"><h3>🔒 {REPORT_KIND[kind]}</h3><span className="b b-gray" style={{ fontSize: ".75rem" }}>سري — لجنة المسابقات</span></div>
      {!has ? <p className="muted">لم يُرسل بعد{form && !form.f.isSubmitted ? " (مسودة لدى كاتب التقرير)" : ""}</p> : (
        <>
          {form?.f.isSubmitted && <>
            <p className="muted" style={{ fontSize: ".82rem" }}>{form.name ?? ""} — أُرسل {fmtDateTime(form.f.submittedAt)}</p>
            <ReportAnswers fields={form.f.fields} answers={form.f.answers} />
          </>}
          {legacy}
          {files.length > 0 && (
            <div className="mt"><strong style={{ fontSize: ".9rem" }}>التقرير الورقي المرفق</strong>
              <ul style={{ margin: ".3rem 0", paddingInlineStart: "1.2rem" }}>{files.map((x) => (
                <li key={x.id}><a href={fileUrl(x.fileKey)!} target="_blank" rel="noreferrer">{x.mime.startsWith("image/") ? "🖼" : "📄"} {x.originalName}</a> <span className="muted" style={{ fontSize: ".75rem" }}>{fmtDateTime(x.uploadedAt)}</span></li>
              ))}</ul></div>
          )}
        </>
      )}
    </div>
  );
}

export const ConfidentialNote = ({ what }: { what: string }) => (
  <div className="card muted" style={{ fontSize: ".9rem" }}>🔒 {what} سري — يطّلع عليه أعضاء لجنة المسابقات فقط.</div>
);
