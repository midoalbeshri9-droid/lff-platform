import { redirect } from "next/navigation";
import { rosterParams } from "@/lib/rosterParams";
import { loadRoster } from "@/lib/roster";
import { fileUrl } from "@/lib/storage";
import { fmtDate } from "@/lib/util";
import { PrintButton } from "@/components/Client";

export const metadata = { title: "قائمة الفريق" };

export default async function PrintRoster({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const raw = await searchParams;
  const sp = new URLSearchParams();
  Object.entries(raw).forEach(([k, v]) => (Array.isArray(v) ? v : [v]).forEach((x) => sp.append(k, x)));
  const P = await rosterParams(sp);
  if (!P) redirect("/denied");
  const data = await loadRoster(P.seasonId, P.clubIds, P.categoryId);
  const cat = P.categoryId ? data.rows[0]?.cat : null;
  return (
    <div className="print-root">
      <style>{`@media print { @page { size: A4 ${P.landscape ? "landscape" : "portrait"}; margin: 10mm; } }`}</style>
      <div className="print-toolbar no-print">
        <PrintButton />
        <span className="muted">{data.groups.length} نادٍ — {data.rows.length} لاعب</span>
      </div>
      {data.groups.length === 0 && <div className="sheet"><p>لا يوجد لاعبون معتمدون بهذه المعايير.</p></div>}
      {data.groups.map((g) => (
        <div key={g.club.id} className={`sheet sheet-break ${P.landscape ? "landscape" : ""}`} style={{ padding: "12mm 12mm" }}>
          <div className="letterhead">
            <div className="ar">{P.fedName}<br /><span style={{ fontWeight: 500 }}>لجنة القيد وأوضاع اللاعبين</span></div>
            <img src="/img/logo-256.png" alt="" />
            <div className="en">{P.fedNameEn}<br /><span style={{ fontWeight: 500 }}>Players Status & Registration</span></div>
          </div>
          <h1 className="doc-title">{P.title} — {g.club.name}</h1>
          <div className="meta-line">
            <span>الموسم الرياضي: <strong>{data.season?.name}</strong>{cat && <> — الفئة: <strong>{cat}</strong></>}</span>
            <span>عدد اللاعبين: <strong>{g.rows.length}</strong></span>
            <span>تاريخ الإصدار: {fmtDate(new Date())}</span>
          </div>
          <table className="roster-table">
            <thead><tr>{P.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
            <tbody>{g.rows.map((x, i) => (
              <tr key={x.r.id}>{P.columns.map((c) => (
                <td key={c.key} className={c.key === "fullName" ? "l" : ""} style={c.key === "signature" ? { minWidth: 80 } : undefined}>
                  {c.key === "photo" ? (x.p.photoKey ? <img src={fileUrl(x.p.photoKey)!} alt="" /> : "") : c.get(x, i)}
                </td>))}</tr>
            ))}</tbody>
          </table>
          <div className="signatures" style={{ gridTemplateColumns: `repeat(${Math.max(P.signatures.length, 1)}, 1fr)` }}>
            {P.signatures.map((s, i) => (
              <div key={i} className="sig stamp-box">{i === 0 && P.stamp && <img src="/img/stamp.png" alt="" />}{s}</div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
