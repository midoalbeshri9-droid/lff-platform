import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { roundDecisions, clubs, competitionTeams } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { inScopeComp, guardPage } from "@/lib/scope";
import { decisionHeader } from "@/lib/decisions";
import { STAFF_ROLE, CARD_REASONS } from "@/lib/labels";
import { fmtDate, fmtDateTime } from "@/lib/util";
import { PageHead, Flash, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { DecisionEditor } from "@/components/DecisionEditor";
import { saveDecision, decisionAdmin } from "../actions";

export default async function DecisionPage({ params, searchParams }: { params: Promise<{ did: string }>; searchParams: SP }) {
  const u = await requireUser("comp.view");
  const id = Number((await params).did);
  const sp = await searchParams;
  const [d] = await db.select().from(roundDecisions).where(eq(roundDecisions.id, id));
  if (!d) notFound();
  guardPage(await inScopeComp(u, d.competitionId));
  const { c, st } = await decisionHeader(d.stageId);
  const issued = d.status === "ISSUED";
  const canEdit = u.can("comp.manage") && !issued;
  const teamNames = (await db.select({ n: clubs.name }).from(competitionTeams).innerJoin(clubs, eq(clubs.id, competitionTeams.clubId)).where(eq(competitionTeams.competitionId, c.id))).map((x) => x.n);
  const printHref = `/print/decision/${d.id}`;
  return (
    <>
      <PageHead title={`قرار الجولة ${d.round}${d.number ? ` — رقم (${d.number})` : ""}`} sub={`${c.name} — ${st.name}`}
        crumbs={[["المسابقات", "/competitions"], [c.name, `/competitions/${c.id}?tab=decisions`], ["قرار الجولة"]]}
        actions={<Link className="btn btn-gold" href={printHref} target="_blank">🖨 طباعة القرار</Link>} />
      <Flash sp={sp} />
      {issued ? (
        <div className="alert ok row" style={{ justifyContent: "space-between" }}>
          <span>✅ صدر القرار رقم ({d.number}) بتاريخ {fmtDate(d.issueDate)} — {d.issuedBy} ({fmtDateTime(d.issuedAt)}). القرار الصادر لا يُعدَّل.</span>
          {u.role === "ADMIN" && <form action={decisionAdmin}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="op" value="reopen" /><Submit className="btn btn-sm btn-light" confirm="إعادة القرار إلى مسودة للتعديل؟">إلغاء الإصدار</Submit></form>}
        </div>
      ) : <div className="alert">مسودة — آخر حفظ {fmtDateTime(d.updatedAt)}. المضمون مولّد من نتائج الجولة وأحداثها وعقوباتها؛ عدّل ما تشاء ثم «إصدار القرار».</div>}
      {canEdit ? (
        <>
          <DecisionEditor key={d.updatedAt.toISOString()} id={d.id} initial={d.content} number={d.number ?? ""} issueDate={d.issueDate ?? ""} clubs={teamNames}
            roles={[...Object.values(STAFF_ROLE), "مدير فني", "مدير الكرة", "منسق إعلامي", "رئيس النادي"]} reasons={CARD_REASONS} action={saveDecision} printHref={printHref} />
          <form action={decisionAdmin} className="mt"><input type="hidden" name="id" value={d.id} /><input type="hidden" name="op" value="delete" />
            <Submit className="btn btn-sm btn-danger" confirm="حذف هذه المسودة؟">حذف المسودة</Submit></form>
        </>
      ) : (
        <div className="card"><iframe src={printHref} style={{ width: "100%", height: "80vh", border: 0 }} title="القرار" /></div>
      )}
    </>
  );
}
