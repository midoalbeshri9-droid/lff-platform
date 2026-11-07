import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { roundDecisions, type DecisionRow } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { inScopeComp } from "@/lib/scope";
import { decisionHeader } from "@/lib/decisions";
import { PrintButton } from "@/components/Client";

const ART = (n: number) => <div className="dz-art">(مـــ ({n}) ـــادة)</div>;

function Table({ cols, rows }: { cols: [string, string, number?][]; rows: DecisionRow[] }) {
  return (
    <table className="dz-t"><thead><tr><th style={{ width: 26 }}>ت</th>{cols.map(([k, l, w]) => <th key={k} style={w ? { width: w } : undefined}>{l}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}><td>{i + 1}</td>{cols.map(([k]) => <td key={k} className={k === "name" ? "nm" : ""}>{k === "cardNo" ? <span className="ltr">{r[k]}</span> : r[k]}</td>)}</tr>)}</tbody></table>
  );
}

/** قالب طباعة قرار لجنة تنظيم المسابقات للجولة — على نمط قرارات اللجنة الورقية */
export default async function DecisionPrint({ params }: { params: Promise<{ id: string }> }) {
  const u = await getCurrentUser();
  if (!u?.can("comp.view") || u.isClub || u.isOfficial) redirect("/denied");
  const [d] = await db.select().from(roundDecisions).where(eq(roundDecisions.id, Number((await params).id)));
  if (!d || !(await inScopeComp(u, d.competitionId))) redirect("/denied");
  const { season } = await decisionHeader(d.stageId);
  const c = d.content;
  const num = d.number ? `(${d.number})` : "(   )";
  const seasonTxt = `${season.replace(/\s*[/-]\s*/, " / ")}م`;
  const dt = d.issueDate ? new Date(d.issueDate + "T12:00:00") : null;
  const dayName = dt ? dt.toLocaleDateString("ar-LY", { weekday: "long" }) : "";
  const dateTxt = d.issueDate ? d.issueDate.replace(/-/g, "/") : "....../....../......";
  let art = 1;
  const cards = [c.players.length > 0, c.staff.length > 0, c.reds.length > 0];
  const Head = ({ prefix }: { prefix: string }) => (
    <div className="dz-head">
      <img src="/img/logo-256.png" alt="" />
      <div className="dz-title">{prefix}قرار لجنة تنظيم المسابقات رقم {num}<br />للموسم الرياضي {seasonTxt}</div>
      <img src="/img/logo-256.png" alt="" />
    </div>
  );
  return (
    <div className="print-root">
      <style>{CSS}</style>
      <div className="print-toolbar no-print">
        {d.status !== "ISSUED" && <span style={{ color: "#b45309", fontWeight: 700 }}>مسودة — لم يصدر بعد</span>}
        <PrintButton />
      </div>
      <div className="sheet dz">
        {d.status !== "ISSUED" && <div className="dz-draft">مسودة</div>}
        <table className="dz-wrap">
          <thead><tr><td><Head prefix="يتبع " /></td></tr></thead>
          <tbody><tr><td>
            <div className="dz-first"><Head prefix="" /></div>
            <div className="dz-subject">{c.subject}</div>
            <ul className="dz-bul"><li><u>لجنة تنظيم المسابقات</u></li></ul>
            <div className="dz-after"><u>بعد الاطلاع</u></div>
            <div className="dz-pre">{c.preamble.map((p, i) => <div key={i}>- {p.replace(/^[-–•]\s*/, "")}</div>)}</div>
            <div className="dz-art">(قـــــرّرت)</div>

            <div className="dz-keep dz-next">{ART(art++)}<p className="dz-p">{c.resultsIntro}</p></div>
            {c.results.map((g, i) => (
              <div key={i} className="dz-keep">
                {g.group && <div className="dz-group"><u>({g.group})</u></div>}
                <table className="dz-t res"><thead><tr><th style={{ width: 26 }}>ت</th><th>الفريقـــان المتباريـــان</th><th colSpan={2}>النتيجـــــة</th></tr></thead>
                  <tbody>{g.rows.map((r, j) => <tr key={j}><td>{j + 1}</td><td className="nm">{r.teams}</td><td style={{ width: 70 }}><span className="ltr">{r.score}</span></td><td style={{ width: "36%" }}>{r.result}</td></tr>)}</tbody></table>
              </div>
            ))}

            {cards.some(Boolean) && <>
              {c.players.length > 0 ? <div className="dz-keep dz-next">
                {ART(art++)}
                <p className="dz-p"><b>{1}-</b> {c.playersIntro}</p>
                <ul className="dz-bul"><li>أولهم اللاعب ({c.players[0].name}). &nbsp;&nbsp; أخرهم اللاعب ({c.players[c.players.length - 1].name}).</li></ul></div> : ART(art++)}
              {c.players.length > 0 && <>
                <Table cols={[["name", "اســـم الرياضـــي"], ["cardNo", "رقم البطاقة", 95], ["category", "الفئة", 50], ["club", "الفريق التابع له", 105], ["opponent", "الفريق المتباري معه", 105], ["reason", "سبب الإنذار", 120]]} rows={c.players} />
              </>}
              {c.staff.length > 0 && <>
                <p className="dz-p dz-next"><b>{cards[0] ? 2 : 1}-</b> {c.staffIntro}</p>
                <Table cols={[["name", "اسم المرافق"], ["cardNo", "رقم البطاقة", 70], ["category", "الفئة", 50], ["club", "الفريق التابع له", 100], ["role", "الصفة", 85], ["reason", "سبب الإنذار", 140]]} rows={c.staff} />
              </>}
              {c.reds.length > 0 && <>
                <p className="dz-p dz-next"><b>{cards.filter(Boolean).length}-</b> {c.redsIntro}</p>
                <Table cols={[["name", "اســـم الرياضـــي"], ["cardNo", "رقم البطاقة", 95], ["club", "الفريق التابع له", 105], ["opponent", "الفريق المتباري معه", 105], ["reason", "السبب", 110], ["ban", "الإيقاف", 60]]} rows={c.reds} />
              </>}
            </>}

            {c.clubSanctions.length > 0 && <div className="dz-keep">
              {ART(art++)}
              <div className="dz-sub">(عقوبـــات الأنديـــة)</div>
              {c.clubSanctions.map((s, i) => <p key={i} className="dz-p"><b>{i + 1}-</b> {s}</p>)}
            </div>}

            {c.extra.map((e, i) => <div key={i} className="dz-keep">{ART(art++)}{e.title && <div className="dz-sub">({e.title})</div>}<p className="dz-p" style={{ whiteSpace: "pre-wrap" }}>{e.body}</p></div>)}

            <div className="dz-keep">
              {ART(art++)}
              <p className="dz-p" style={{ textAlign: "center" }}><b>{c.closing}</b></p>
              <div className="dz-sign">
                <div className="who"><div>{c.signerName}</div><div>{c.signerTitle}</div></div>
                <div className="when">صدر يوم {dayName} الموافق {dateTxt}م</div>
              </div>
            </div>
          </td></tr></tbody>
        </table>
      </div>
    </div>
  );
}

const HEAD_H = "34mm";
const CSS = `
.dz { font-family: "Cairo", Tahoma, sans-serif; color: #000; padding: 10mm 12mm; }
.dz-wrap { width: 100%; border-collapse: collapse; }
.dz-wrap > thead td, .dz-wrap > tbody > tr > td { padding: 0; }
.dz-head { height: ${HEAD_H}; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dz-head img { width: 26mm; height: 26mm; object-fit: contain; }
.dz-title { flex: 1; text-align: center; font-weight: 800; font-size: 19pt; line-height: 1.45; }
/* الصفحة الأولى: يُغطّى رأس «يتبع» المتكرر برأس القرار نفسه */
.dz-first { margin-top: -${HEAD_H}; position: relative; background: #fff; z-index: 2; }
.dz-subject { text-align: center; font-weight: 800; font-size: 14pt; line-height: 1.6; margin: 8px 0 6px; }
.dz-bul { margin: 4px 0; padding-inline-start: 22px; font-weight: 800; font-size: 12pt; }
.dz-after { font-weight: 800; font-size: 12pt; margin: 0 0 4px 0; }
.dz-pre { font-weight: 700; font-size: 11.5pt; line-height: 1.85; text-align: justify; }
.dz-pre > div { margin-bottom: 3px; }
.dz-art { text-align: center; font-weight: 800; font-size: 16pt; margin: 12px 0 6px; }
.dz-sub { font-weight: 800; font-size: 14pt; margin: 6px 0; }
.dz-group { text-align: center; font-weight: 800; font-size: 15pt; margin: 4px 0; }
.dz-p { font-weight: 700; font-size: 12pt; line-height: 1.8; text-align: justify; margin: 6px 0; }
.dz-t { width: 100%; border-collapse: collapse; font-size: 9.5pt; font-weight: 700; margin: 4px 0 10px; }
.dz-t th { background: linear-gradient(#cfe6f3, #a9d0e6); border: 1px solid #555; padding: 4px; font-weight: 800; }
.dz-t td { border: 1px solid #555; padding: 3px 5px; text-align: center; }
.dz-t tbody tr:nth-child(even) td { background: #ececec; }
.dz-t td.nm { text-align: right; }
.dz-t.res { font-size: 12pt; }
.dz-t tr { page-break-inside: avoid; break-inside: avoid; }
.dz-keep { break-inside: avoid; page-break-inside: avoid; }
.dz-next { break-after: avoid; page-break-after: avoid; }
.dz .ltr { direction: ltr; unicode-bidi: isolate; display: inline-block; }
.dz-sign { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 18px; min-height: 55mm; }
.dz-sign .who { font-weight: 800; font-size: 14pt; text-align: center; align-self: flex-start; line-height: 2; }
.dz-sign .when { font-weight: 800; font-size: 11pt; text-decoration: underline; }
.dz-draft { position: absolute; top: 40%; left: 0; right: 0; text-align: center; font-size: 90pt; color: rgba(200,0,0,.08); transform: rotate(-30deg); pointer-events: none; font-weight: 800; }
@media print { @page { size: A4; margin: 8mm 6mm; } .dz { padding: 0 4mm; } }
`;
