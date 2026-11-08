import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { matchReportForms, reportFiles, officials } from "@/db/schema";
import { fileUrl } from "@/lib/storage";
import { fmtDateTime } from "@/lib/util";
import { REPORT_KIND, type ReportKind } from "@/lib/reports";
import { ReportAnswers } from "./ReportFields";
import { ObserverReportForm } from "./ObserverReportForm";
import { observerContext } from "@/lib/observerReport";
import { CARD_REASONS } from "@/lib/labels";
import { Submit } from "./Client";
import { adoptObserverCards } from "@/app/(main)/competitions/actions";

/** عرض تقرير الحكم أو المراقب (خانات النموذج + المرفقات) — للجنة المسابقات فقط */
export async function MatchReportView({ matchId, kind, legacy, canAdopt }: { matchId: number; kind: ReportKind; legacy?: React.ReactNode; canAdopt?: boolean }) {
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
            {form.f.data ? await observerBody(matchId, form.f, !!canAdopt) : <ReportAnswers fields={form.f.fields} answers={form.f.answers} />}
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

/** تقرير المراقب بالنموذج المعتمد: عرض للقراءة + الطباعة + اعتماد الإنذارات في أحداث المباراة */
async function observerBody(matchId: number, f: typeof matchReportForms.$inferSelect, canAdopt: boolean) {
  const ctx = (await observerContext(matchId))!;
  const n = f.data!.cautions.length + f.data!.sendoffs.length;
  return (
    <>
      <div className="row" style={{ gap: ".4rem", flexWrap: "wrap" }}>
        <a className="btn btn-sm btn-light" href={`/print/observer/${matchId}`} target="_blank" rel="noreferrer">🖨 طباعة التقرير (النموذج المعتمد)</a>
        {canAdopt && n > 0 && ctx.m.reportStatus !== "APPROVED" && (
          <form action={adoptObserverCards}><input type="hidden" name="matchId" value={matchId} />
            <Submit className="btn btn-sm btn-gold" confirm={`نقل ${n} من إنذارات/طرد المراقب إلى أحداث المباراة؟ (المسجّل مسبقًا لا يتكرر)`}>✅ اعتماد إنذارات المراقب ({n})</Submit></form>
        )}
        {f.adoptedAt && <span className="b b-green" style={{ fontSize: ".75rem" }}>اعتُمدت الإنذارات — {f.adoptedBy} {fmtDateTime(f.adoptedAt)}</span>}
      </div>
      <details className="mt"><summary>عرض تفاصيل التقرير</summary>
        <ObserverReportForm initial={f.data!} home={ctx.home} away={ctx.away} squad={[]} crew={ctx.crew} category={ctx.category} reasons={CARD_REASONS} disabled />
      </details>
    </>
  );
}
