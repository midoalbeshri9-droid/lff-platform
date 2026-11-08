import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assignments } from "@/db/schema";
import { inScopeMatch } from "@/lib/scope";
import { getCurrentUser } from "@/lib/auth";
import { canSeeReports } from "@/lib/reports";
import { observerContext, observerForm } from "@/lib/observerReport";
import { CRITERIA, EVAL_TITLE, evalTotal, emptyReport, maxOf, type EvalRole } from "@/lib/observerForm";
import type { ObserverCard } from "@/db/schema";
import { PrintButton } from "@/components/Client";

const DOTS = "................................................";
const v = (x: React.ReactNode, w = DOTS) => (x === null || x === undefined || x === "" ? <span className="ob-dots">{w}</span> : <b>{x}</b>);

/** طباعة تقرير مراقب المباراة على النموذج المعتمد (4 صفحات) — للجنة المسابقات وللمراقب نفسه */
export default async function ObserverPrint({ params }: { params: Promise<{ id: string }> }) {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  const id = Number((await params).id);
  if (u.isOfficial) {
    const mine = await db.select().from(assignments).where(eq(assignments.matchId, id));
    if (!mine.some((a) => a.officialId === u.officialId && a.role === "COMMISSIONER")) redirect("/denied");
  } else if (!canSeeReports(u) || !(await inScopeMatch(u, id))) redirect("/denied");
  const ctx = await observerContext(id);
  if (!ctx) notFound();
  const r = await observerForm(id);
  const d = r?.data ?? emptyReport();
  const dt = ctx.m.kickoff;
  const day = dt ? dt.toLocaleDateString("ar-LY", { weekday: "long", timeZone: "Africa/Tripoli" }) : "";
  const date = dt ? dt.toLocaleDateString("en-GB", { timeZone: "Africa/Tripoli" }) : "";
  const tName = (cid: number | null) => (cid === ctx.home.id ? ctx.home.name : cid === ctx.away.id ? ctx.away.name : "");
  const res = (p: [string, string]) => {
    if (p[0] === "" || p[1] === "") return { s: null, w: null };
    const h = Number(p[0]), a = Number(p[1]);
    return { s: <span className="ltr">{p[1]} - {p[0]}</span>, w: h > a ? ctx.home.name : a > h ? ctx.away.name : "تعادل" };
  };
  const line = (label: string, p: [string, string], pre = "لصالح") => { const x = res(p); return <div className="ob-l"><span className="ob-k">{label} :</span> {v(x.s, ".........\\.........")} <span className="ob-k">{pre} :</span> {v(x.w)}</div>; };
  const pad = (rows: ObserverCard[], n: number) => [...rows, ...Array(Math.max(0, n - rows.length)).fill(null)] as (ObserverCard | null)[];
  const cardTable = (rows: ObserverCard[], n: number, title: string, color: string) => (
    <div className="ob-cards">
      <div className="ob-side" style={{ background: color }}><span>{title}</span></div>
      <table className="ob-t"><thead><tr><th style={{ width: 22 }}>ت</th><th>اسم الرياضي رباعيًا</th><th style={{ width: 82 }}>بطاقة رياضية</th><th style={{ width: 80 }}>الفريق</th><th style={{ width: 52 }}>الفئة</th><th style={{ width: 95 }}>سبب الإنذار</th><th style={{ width: 36 }}>الوقت</th></tr></thead>
        <tbody>{pad(rows, n).map((c, i) => <tr key={i}><td>{i + 1}</td><td className="nm">{c?.name}</td><td><span className="ltr">{c?.cardNo}</span></td><td>{c ? tName(c.clubId) : ""}</td><td>{c ? c.category || ctx.category : ""}</td><td>{c?.reason}</td><td>{c?.minute}</td></tr>)}</tbody></table>
    </div>
  );
  const scorers = (cid: number) => {
    const rows = d.scorers.filter((x) => x.clubId === cid);
    return (
      <table className="ob-t sc"><thead><tr><th colSpan={4} style={{ background: "#fff", textAlign: "right" }}>لفريق {tName(cid)}</th></tr><tr><th style={{ width: 22 }} className="bl">ت</th><th style={{ width: 52 }}>فانلة رقم</th><th style={{ width: 52 }}>الأهداف</th><th>الوقت والملاحظات</th></tr></thead>
        <tbody>{Array.from({ length: 8 }, (_, i) => rows[i]).map((x, i) => <tr key={i}><td className="bl">{i + 1}</td><td>{x?.shirt}</td><td>{x?.goals}</td><td>{x?.notes}</td></tr>)}</tbody></table>
    );
  };
  const evalBlock = (role: EvalRole) => {
    const e = d.evals[role];
    const t = evalTotal(role, e?.s);
    const long = role === "REFEREE";
    return (
      <div className="ob-ev">
        <div className="ob-h2">{EVAL_TITLE[role]}</div>
        {CRITERIA[role].map(([label, max], i) => (
          <div key={i} className={`ob-crit ${long ? "long" : ""}`}>
            <div className="txt"><b>{i + 1}- {label} :-</b> {e?.n[i] ? <span className="nt">{e.n[i]}</span> : <span className="ob-dots">{long ? "" : DOTS}</span>}</div>
            <div className="bx"><span className="mx">{max}</span><span className="sc">{e?.s[i] ?? ""}</span></div>
          </div>
        ))}
        <div className="ob-tot"><div><b>مجموع الدرجات</b><span>{t ? `${t.total} من ${maxOf(role)}` : ""}</span></div><div><b>النسبة</b><span>{t ? `${t.pct}%` : ""}</span></div><div><b>التقديـــــر</b><span>{t?.grade ?? ""}</span></div></div>
      </div>
    );
  };
  const Head = () => (
    <div className="ob-head"><img src="/img/logo-256.png" alt="" /><div className="n1">الاتحاد الليبي لكرة القدم</div><div className="n2">لجنة تنظيم المسابقات</div>
      <div className="ob-title"><span>تقرير مراقب المباراة</span></div></div>
  );
  const Foot = ({ n }: { n: number }) => <div className="ob-pg">{n}</div>;
  return (
    <div className="print-root">
      <style>{CSS}</style>
      <div className="print-toolbar no-print">{!r?.isSubmitted && <span style={{ color: "#b45309", fontWeight: 700 }}>لم يُرسل التقرير بعد</span>}<PrintButton /></div>

      <div className="sheet ob">
        <Head />
        <div className="ob-l"><span className="ob-k">خاص بمسابقة</span> (( {v(ctx.comp)} )) <span className="ob-k">للموسم الرياضي</span> {v(ctx.season)}</div>
        <div className="ob-l"><span className="ob-k">الأسبوع</span> (( {v(ctx.round)} )) <span className="ob-k">رقم المباراة بالجدول</span> (( {v(ctx.no)} ))</div>
        <div className="ob-gap" />
        <div className="ob-l"><span className="ob-k">اسم المراقب :</span> {v(ctx.observer?.name)} <span className="ob-k">درجته :</span> {v(ctx.observer?.grade)}</div>
        <div className="ob-l"><span className="ob-k">مباراة فريق :</span> {v(ctx.home.name)} <span className="ob-k">مع فريق :</span> {v(ctx.away.name)}</div>
        <div className="ob-l"><span className="ob-k">الملعب :</span> {v(ctx.stadium)} <span className="ob-k">التاريخ :</span> {v(day)} <span className="ob-k">الموافق :</span> {v(date)}</div>
        {line("نتيجة الشوط الأول", d.ht, "لصالح فريق")}
        {line("النتيجة النهائية", d.ft)}
        {line("نتيجة الوقت الإضافي", d.et)}
        {line("نتيجة الركلات الترجيحية", d.pens)}
        {(["REFEREE", "AR1", "AR2", "FOURTH"] as EvalRole[]).map((k) => (
          <div key={k} className="ob-l"><span className="ob-k">{{ REFEREE: "الحكم", AR1: "الحكم المساعد الأول", AR2: "الحكم المساعد الثاني", FOURTH: "الحكم الرابع" }[k]} :</span> {v(ctx.crew[k]?.name)} <span className="ob-k">الدرجة :</span> {v(ctx.crew[k]?.grade)}</div>
        ))}
        <Foot n={1} />
      </div>

      <div className="sheet ob">
        {cardTable(d.cautions, Math.max(12, d.cautions.length), "الإنذارات", "#f5ec00")}
        {cardTable(d.sendoffs, Math.max(6, d.sendoffs.length), "الطـــرد", "#e8376a")}
        <div className="ob-sub">• مسجلو الأهداف</div>
        <div className="ob-two">{scorers(ctx.home.id)}{scorers(ctx.away.id)}</div>
        <Foot n={2} />
      </div>

      <div className="sheet ob ob3">
        {evalBlock("REFEREE")}
        {evalBlock("AR1")}
        {evalBlock("AR2")}
        {evalBlock("FOURTH")}
        <div className="ob-l"><span className="ob-k">اسم المراقب</span> {v(ctx.observer?.name)} <span className="ob-k">المباراة</span> ({v(ctx.home.name)} × {v(ctx.away.name)})</div>
        <Foot n={3} />
      </div>

      <div className="sheet ob">
        <div className="ob-sub">• ملاحظات والنصائح المتعلقة بالإدارة ولجنتي المسابقات والتحكيم :-</div>
        <div className="ob-lines" style={{ minHeight: "38mm" }}>{d.adminNotes}</div>
        <div className="ob-sub">• ملاحظات عامة :-</div>
        <div className="ob-lines" style={{ minHeight: "150mm" }}>{d.generalNotes}</div>
        <div className="ob-sig">
          <div><b>ملاحظة ||</b></div>
          <div><b>مبـــاراة :</b> {ctx.home.name} × {ctx.away.name}</div>
          <div><b>اسم المراقب :</b> {ctx.observer?.name}</div>
          <div><b>التـــاريخ :</b> {r?.submittedAt ? r.submittedAt.toLocaleDateString("en-GB", { timeZone: "Africa/Tripoli" }) : "....../....../......"}</div>
          <div><b>التـــوقيع :</b> ......................</div>
        </div>
        <Foot n={4} />
      </div>
    </div>
  );
}

const CSS = `
.ob { font-family: "Cairo", Tahoma, sans-serif; color: #000; padding: 12mm 14mm 16mm; page-break-after: always; break-after: page; font-size: 10.5pt; }
.ob:last-child { page-break-after: auto; break-after: auto; }
.ob .ltr { direction: ltr; unicode-bidi: isolate; display: inline-block; }
.ob-head { text-align: center; margin-bottom: 6mm; }
.ob-head img { width: 22mm; height: 22mm; object-fit: contain; }
.ob-head .n1 { font-weight: 800; font-size: 15pt; } .ob-head .n2 { font-weight: 800; font-size: 13pt; }
.ob-title { display: flex; align-items: center; gap: 10px; margin-top: 4mm; }
.ob-title::before, .ob-title::after { content: ""; flex: 1; border-top: 2px solid #000; }
.ob-title span { font-weight: 800; font-size: 12.5pt; }
.ob-l { font-weight: 700; margin: 0 0 7mm; line-height: 1.6; }
.ob-k { font-weight: 800; }
.ob-dots { color: #555; letter-spacing: 1px; font-weight: 400; }
.ob-gap { height: 4mm; }
.ob-pg { position: absolute; bottom: 8mm; left: 0; right: 0; text-align: center; font-weight: 800; font-size: 13pt; }
.ob-cards { display: flex; margin-bottom: 6mm; }
.ob-side { width: 14mm; border: 1px solid #000; border-inline-start: none; display: flex; align-items: center; justify-content: center; }
.ob-side span { writing-mode: vertical-rl; font-weight: 800; font-size: 18pt; letter-spacing: 2px; }
.ob-t { flex: 1; width: 100%; border-collapse: collapse; font-size: 9pt; }
.ob-t th { background: #dfe8f3; border: 1px solid #000; padding: 3px; font-weight: 800; }
.ob-t td { border: 1px solid #000; height: 7.2mm; padding: 1px 4px; text-align: center; }
.ob-t td.nm { text-align: right; }
.ob-t.sc td { height: 6.5mm; } .ob-t .bl { background: #8fc1e6; }
.ob-sub { font-weight: 800; font-size: 11.5pt; margin: 3mm 0 2mm; }
.ob-two { display: grid; grid-template-columns: 1fr 1fr; gap: 0; }
.ob-h2 { text-align: center; font-weight: 800; font-size: 13pt; text-decoration: underline; margin: 1mm 0 1mm; }
.ob-crit { display: flex; gap: 6px; align-items: flex-end; margin-bottom: 1.4mm; }
.ob-crit .txt { flex: 1; border-bottom: 1px dotted #555; min-height: 6mm; font-size: 9.5pt; }
.ob-crit.long .txt { min-height: 7.5mm; }
.ob-crit .nt { font-weight: 400; }
.ob-crit .bx { display: flex; flex-direction: row-reverse; }
.ob-crit .bx span { width: 9mm; height: 6mm; border: 1.5px solid #000; display: flex; align-items: center; justify-content: center; font-weight: 800; }
.ob-crit .bx .mx { border-inline-start: none; }
.ob-tot { display: flex; gap: 4mm; justify-content: flex-start; margin: 0 0 1mm; font-size: 8pt; }
.ob-tot div { display: flex; flex-direction: column; } .ob-tot span { border: 1px solid #000; min-width: 28mm; min-height: 5mm; text-align: center; font-weight: 800; font-size: 9.5pt; }
.ob-lines { white-space: pre-wrap; line-height: 8mm; background-image: repeating-linear-gradient(transparent 0 7.6mm, #999 7.6mm 8mm); font-size: 10.5pt; margin-bottom: 4mm; }
.ob3 { padding-top: 8mm; } .ob3 > .ob-l { position: absolute; bottom: 16mm; inset-inline: 14mm; margin: 0; }
.ob-sig { line-height: 2; } .ob-sig b { display: inline-block; min-width: 26mm; }
@media print { @page { size: A4; margin: 0; } .ob { min-height: 297mm; position: relative; } }
`;
