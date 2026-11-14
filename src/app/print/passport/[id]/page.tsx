export const dynamic = "force-dynamic";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { players } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { inScopePlayer } from "@/lib/scope";
import { playerPassport } from "@/lib/passport";
import { PRO_LEVEL } from "@/lib/labels";
import { fileUrl } from "@/lib/storage";
import { PrintButton } from "@/components/Client";

const dmy = (s: string | null) => (s ? s.split("-").reverse().join("/") : "");

/** جواز اللاعب للطباعة أو الحفظ PDF (مثل Player Passport في FIFA Connect) */
export default async function PassportPrint({ params }: { params: Promise<{ id: string }> }) {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  const id = Number((await params).id);
  if (!u.can("reg.view") || !(await inScopePlayer(u, id))) redirect("/denied");
  const [p] = await db.select().from(players).where(eq(players.id, id));
  if (!p) notFound();
  const pass = await playerPassport(id);
  return (
    <div className="print-root">
      <style>{CSS}</style>
      <div className="print-toolbar no-print"><PrintButton /></div>
      <div className="sheet pp">
        <div className="pp-head">
          <div><b>الاتحاد الليبي لكرة القدم</b><div>لجنة أوضاع اللاعبين وانتقالاتهم</div></div>
          <img src="/img/logo-256.png" alt="" />
          <div className="en"><b>Libyan Football Federation</b><div>Player Passport</div></div>
        </div>
        <h1>جواز اللاعب <small>Player Passport</small></h1>
        <div className="pp-id">
          {p.photoKey ? <img src={fileUrl(p.photoKey)!} alt="" /> : <div className="ph">👤</div>}
          <table><tbody>
            <tr><th>الاسم</th><td>{p.fullName}</td><th>Name</th><td className="ltr">{p.fullNameEn ?? ""}</td></tr>
            <tr><th>تاريخ الميلاد</th><td>{dmy(p.dateOfBirth)}</td><th>الجنسية</th><td>{p.nationality}</td></tr>
            <tr><th>رقم البطاقة (MA ID)</th><td className="ltr">{p.cardNo ?? ""}</td><th>FIFA ID</th><td className="ltr">{p.fifaId ?? ""}</td></tr>
            <tr><th>الرقم الوطني</th><td className="ltr">{p.nationalId ?? ""}</td><th>المستوى الحالي</th><td>{PRO_LEVEL[p.professionalLevel] ?? p.professionalLevel}</td></tr>
          </tbody></table>
        </div>
        <p className="note">سجل الأندية التي سُجّل لها اللاعب لاعبًا لكرة القدم منذ عيد ميلاده الثاني عشر{pass.from12 ? ` (${dmy(pass.from12)})` : ""}. السجلات المائلة أُضيفت يدويًا من سجلات سابقة للمنظومة.</p>
        <table className="pp-t"><thead><tr><th>#</th><th>النادي</th><th>الدولة</th><th>المستوى</th><th>نوع القيد</th><th>من</th><th>إلى</th></tr></thead>
          <tbody>{pass.rows.length === 0 ? <tr><td colSpan={7}>لا توجد سجلات</td></tr> : pass.rows.map((r, i) => (
            <tr key={i} className={r.manual ? "m" : ""}><td>{i + 1}</td><td>{r.club}</td><td>{r.country}</td><td>{r.level ? PRO_LEVEL[r.level] ?? r.level : "—"}</td><td>{r.loan ? "إعارة" : "دائم"}</td><td>{dmy(r.from)}</td><td>{r.to ? dmy(r.to) : "حتى الآن"}</td></tr>))}</tbody></table>
        <div className="pp-sign">
          <div>حُرّر بتاريخ: {dmy(new Date().toISOString().slice(0, 10))}</div>
          <div className="box">الأمين العام<br /><span>التوقيع والختم</span></div>
        </div>
      </div>
    </div>
  );
}

const CSS = `
.pp { font-family: "Cairo", Tahoma, sans-serif; padding: 12mm 14mm; color: #000; font-size: 10.5pt; }
.pp-head { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0b5d3b; padding-bottom: 3mm; }
.pp-head img { width: 20mm; height: 20mm; object-fit: contain; } .pp-head .en { direction: ltr; text-align: left; }
.pp h1 { text-align: center; font-size: 18pt; margin: 5mm 0; } .pp h1 small { font-size: 11pt; color: #555; }
.pp-id { display: flex; gap: 5mm; align-items: flex-start; }
.pp-id > img, .pp-id .ph { width: 30mm; height: 38mm; object-fit: cover; border: 1px solid #999; display: grid; place-items: center; font-size: 28pt; }
.pp-id table { flex: 1; border-collapse: collapse; } .pp-id th, .pp-id td { border: 1px solid #bbb; padding: 1.5mm 2mm; text-align: start; } .pp-id th { background: #f0f4f1; width: 22%; font-weight: 700; }
.pp .ltr { direction: ltr; text-align: left; }
.pp .note { font-size: 9pt; color: #444; margin: 4mm 0 2mm; }
.pp-t { width: 100%; border-collapse: collapse; } .pp-t th { background: #0b5d3b; color: #fff; padding: 2mm; } .pp-t td { border-bottom: 1px solid #ccc; padding: 2mm; text-align: center; }
.pp-t tr.m td { font-style: italic; color: #333; }
.pp-sign { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 12mm; }
.pp-sign .box { border: 1px dashed #777; width: 60mm; height: 28mm; text-align: center; padding-top: 3mm; font-weight: 700; } .pp-sign .box span { font-weight: 400; color: #666; font-size: 9pt; }
@media print { @page { size: A4; margin: 0; } }
`;
