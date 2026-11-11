import type { contracts } from "@/db/schema";
import { fmtDate } from "@/lib/util";

type C = typeof contracts.$inferSelect;
const cur = (c: string) => (c === "LYD" ? "د.ل" : c);
const money = (v: string | number | null) => Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
const Row = ({ k, v }: { k: string; v?: React.ReactNode }) => (
  <div className="kv"><span className="muted">{k}</span><strong>{v || "—"}</strong></div>
);

/** ملخص العقد الإلكتروني للقراءة (النادي بعد الإرسال، ولجنة أوضاع اللاعبين) */
export function EContractSummary({ c, words, playerName, clubName }: { c: C; words: Record<string, string>; playerName: string; clubName: string }) {
  const d = c.doc;
  const m = (v: string | null, k: string) => (Number(v) > 0 ? <>{money(v)} {cur(c.currency)} <small className="muted">({words[k]})</small></> : null);
  return (
    <div className="grid g2">
      <div className="card">
        <h3>الطرفان</h3>
        <Row k="الطرف الأول (النادي)" v={clubName} />
        <Row k="يمثله" v={d && `${d.club.repName} — ${d.club.repTitle}`} />
        <Row k="عنوان / هاتف النادي" v={d && [d.club.address, d.club.phone, d.club.email].filter(Boolean).join(" · ")} />
        <Row k="الطرف الثاني (اللاعب)" v={<>{playerName}{d?.player.nameEn && <div className="ltr muted">{d.player.nameEn}</div>}</>} />
        <Row k="الجنسية / الميلاد" v={d && [d.player.nationality, d.player.birthPlace, fmtDate(d.player.birthDate)].filter(Boolean).join(" · ")} />
        <Row k="وثيقة الإثبات" v={d && [d.player.idType, d.player.idNumber, d.player.idIssuePlace, d.player.idExpiry && "صالحة حتى " + fmtDate(d.player.idExpiry)].filter(Boolean).join(" · ")} />
        <Row k="هاتف / عنوان اللاعب" v={d && [d.player.phone, d.player.address, d.player.email].filter(Boolean).join(" · ")} />
        <Row k="وكيل اللاعب" v={d?.agent ? `${d.agent.name} (${d.agent.nationality}) — بطاقة ${d.agent.licenseNo} صادرة عن ${d.agent.licenseIssuer}، صالحة حتى ${fmtDate(d.agent.licenseExpiry)}` : "بدون وكيل"} />
        <Row k="مكان وتاريخ التوقيع" v={d && `${d.signCity}، ${d.signCountry} — ${fmtDate(d.signDate)}`} />
      </div>
      <div className="card">
        <h3>المدة والمقابل المالي</h3>
        <Row k="مدة العقد" v={d?.duration} />
        <Row k="من / إلى" v={`${fmtDate(c.startDate)} ← ${fmtDate(c.endDate)}`} />
        <Row k="ينتهي" v={d?.termType === "SEASON" ? `بانتهاء الموسم الرياضي ${d.endSeason}` : "في تاريخ محدد"} />
        <Row k="القيمة الإجمالية" v={m(c.totalValue, "totalValue")} />
        <Row k="مقدم العقد" v={m(c.signingBonus, "signingBonus")} />
        <Row k="الراتب الشهري" v={m(c.monthlySalary, "monthlySalary")} />
        <Row k="بدل السكن السنوي" v={m(c.housingAmount, "housingAmount")} />
        <Row k="بدل المواصلات" v={m(c.transportAmount, "transportAmount")} />
        <Row k="رسوم الاتحاد 3%" v={Number(c.totalValue) > 0 ? `${money((Number(c.totalValue) * 0.03).toFixed(2))} ${cur(c.currency)}` : null} />
        {c.otherBenefits && <Row k="ملحق / امتيازات أخرى" v={<span style={{ whiteSpace: "pre-wrap" }}>{c.otherBenefits}</span>} />}
      </div>
    </div>
  );
}

/** بطاقة مختصرة للعقد داخل صفحة طلب القيد */
export function ContractBrief({ c, href, showMoney, createSlot }: { c: C | null; href: string; showMoney: boolean; createSlot?: React.ReactNode }) {
  if (!c) return <div><p className="muted">لم يُكتب عقد لهذا القيد بعد.</p>{createSlot}</div>;
  const st = { DRAFT: ["مسودة", "b-gray"], RETURNED: ["معاد للاستكمال", "b-amber"], SUBMITTED: ["بانتظار الاعتماد", "b-blue"], ACTIVE: ["معتمد وساري", "b-green"], TERMINATED: ["منتهٍ", "b-gray"], EXPIRED: ["منتهي المدة", "b-gray"] }[c.status] as [string, string];
  return (
    <div>
      <Row k="الحالة" v={<span className={`b ${st[1]}`}>{st[0]}</span>} />
      {c.number && <Row k="رقم العقد" v={<span className="kbd">{c.number}</span>} />}
      <Row k="المدة" v={`${fmtDate(c.startDate)} ← ${fmtDate(c.endDate)}`} />
      {showMoney && <Row k="القيمة الإجمالية" v={Number(c.totalValue) > 0 ? `${money(c.totalValue)} ${cur(c.currency)}` : null} />}
      <p style={{ marginTop: 10 }}><a className="btn btn-sm btn-light" href={href}>فتح العقد ←</a></p>
    </div>
  );
}
