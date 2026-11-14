import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { players } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { guardPage, inScopePlayer } from "@/lib/scope";
import { mergeCounts } from "@/lib/merge";
import { fileUrl } from "@/lib/storage";
import { fmtDate } from "@/lib/util";
import { PageHead, Flash, Field, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { doMerge } from "../actions";

const COUNT_LABEL: Record<string, string> = { registrations: "قيود", suspensions: "إيقافات", matchEvents: "أحداث مباريات", matchSquads: "قوائم مباريات", contracts: "عقود", sanctions: "عقوبات", competitionSquads: "قوائم مسابقات", correspondence: "مراسلات", archiveDocs: "وثائق أرشيف", passportRecords: "سجلات جواز" };

export default async function MergePage({ searchParams }: { searchParams: SP }) {
  const u = await requireUser("reg.edit");
  const sp = await searchParams;
  const mId = Number(sp.master), dId = Number(sp.dup);
  const [m] = await db.select().from(players).where(eq(players.id, mId));
  const [d] = await db.select().from(players).where(eq(players.id, dId));
  if (!m || !d) return <p>السجل غير موجود</p>;
  guardPage((await inScopePlayer(u, mId)) && (await inScopePlayer(u, dId)));
  const cnt = await mergeCounts(dId);
  const F = ["fullName", "fullNameEn", "dateOfBirth", "nationality", "nationalId", "cardNo", "passportNo", "fifaId", "placeOfBirth", "phone"] as const;
  const L: Record<string, string> = { fullName: "الاسم", fullNameEn: "الاسم بالإنجليزية", dateOfBirth: "تاريخ الميلاد", nationality: "الجنسية", nationalId: "الرقم الوطني", cardNo: "رقم البطاقة (MA ID)", passportNo: "الجواز", fifaId: "FIFA ID", placeOfBirth: "مكان الميلاد", phone: "الهاتف" };
  const v = (p: typeof m, k: (typeof F)[number]) => (k === "dateOfBirth" ? fmtDate(p[k]) : (p[k] as string | null) ?? "—");
  return (
    <>
      <PageHead title="دمج سجلين مكررين" sub="السجل الرئيسي يبقى، والمكرر تُنقل كل بياناته إليه ثم يُحذف — لا يمكن التراجع" crumbs={[["المكررون", "/registration/duplicates"], ["دمج"]]}
        actions={<Link className="btn btn-light" href={`/registration/duplicates/merge?master=${dId}&dup=${mId}`}>⇄ تبديل الرئيسي والمكرر</Link>} />
      <Flash sp={sp} />
      <div className="card table-wrap">
        <table className="t no-num"><thead><tr><th></th><th>✅ الرئيسي (يبقى) #{m.id}</th><th>🗑 المكرر (يُدمج ويُحذف) #{d.id}</th></tr></thead>
          <tbody>
            <tr><td>الصورة</td><td>{m.photoKey ? <img className="thumb" src={fileUrl(m.photoKey)!} alt="" /> : "—"}</td><td>{d.photoKey ? <img className="thumb" src={fileUrl(d.photoKey)!} alt="" /> : "—"}</td></tr>
            {F.map((k) => <tr key={k}><td>{L[k]}</td><td>{v(m, k)}</td><td style={!m[k] && d[k] ? { background: "#effaf2" } : undefined}>{v(d, k)}</td></tr>)}
          </tbody></table>
        <p className="muted" style={{ fontSize: ".85rem" }}>الخانات الخضراء ناقصة في الرئيسي وستُنقل إليه من المكرر.</p>
        <p><b>سيُنقل إلى الرئيسي:</b> {Object.entries(cnt).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${COUNT_LABEL[k]}`).join("، ") || "لا شيء"}</p>
      </div>
      <form action={doMerge} className="card">
        <input type="hidden" name="master" value={m.id} /><input type="hidden" name="dup" value={d.id} />
        <div className="alert warn">⚠ تأكد أن السجلين لنفس الشخص فعلًا، لا مجرد تشابه أسماء. الدمج نهائي.</div>
        <Field label="اكتب كلمة «دمج» للتأكيد"><input name="confirm" required autoComplete="off" /></Field>
        <Submit className="btn btn-danger" confirm="دمج السجلين نهائيًا؟">🔀 دمج نهائي</Submit>
      </form>
    </>
  );
}
