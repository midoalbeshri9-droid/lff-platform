import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { competitions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { standings } from "@/lib/competition";
import { fmtDate } from "@/lib/util";
import { PrintButton } from "@/components/Client";
import { Letterhead } from "@/components/Letterhead";

export default async function Standings({ params }: { params: Promise<{ id: string }> }) {
  const u = await getCurrentUser();
  if (!u?.can("comp.view")) redirect("/denied");
  const id = Number((await params).id);
  const [c] = await db.select().from(competitions).where(eq(competitions.id, id));
  const rows = await standings(id);
  const groups = [...new Set(rows.map((r) => r.group ?? ""))];
  return (
    <div className="print-root">
      <div className="print-toolbar no-print"><PrintButton /></div>
      <div className="sheet">
        <Letterhead sub="لجنة المسابقات" subEn="Competitions Committee" />
        <h1 className="doc-title">ترتيب {c?.name}</h1>
        <div className="meta-line"><span>حتى تاريخ {fmtDate(new Date())}</span></div>
        {groups.map((g) => (
          <table key={g} className="roster-table" style={{ marginBottom: 12 }}>
            <thead>{g && <tr><th colSpan={10}>المجموعة {g}</th></tr>}<tr><th>#</th><th>الفريق</th><th>لعب</th><th>فاز</th><th>تعادل</th><th>خسر</th><th>له</th><th>عليه</th><th>الفارق</th><th>النقاط</th></tr></thead>
            <tbody>{rows.filter((r) => (r.group ?? "") === g).map((r, i) => (
              <tr key={r.clubId}><td>{i + 1}</td><td className="l">{r.name}</td><td>{r.p}</td><td>{r.w}</td><td>{r.d}</td><td>{r.l}</td><td>{r.gf}</td><td>{r.ga}</td><td>{r.gd}</td><td><strong>{r.pts}</strong></td></tr>
            ))}</tbody>
          </table>
        ))}
      </div>
    </div>
  );
}
