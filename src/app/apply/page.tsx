import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { clubs } from "@/db/schema";
import { POSITION, OFFICIAL_TYPE, SELF_OFFICIAL_TYPES } from "@/lib/labels";
import { getSetting } from "@/lib/registration";
import { Submit } from "@/components/Client";
import { ApplyShell } from "./Shell";
import { submitSelfApplication } from "./actions";

export const metadata = { title: "التسجيل الذاتي" };
export const dynamic = "force-dynamic";

const F = ({ l, children, full }: { l: string; children: React.ReactNode; full?: boolean }) => (
  <div className={`field${full ? " full" : ""}`}><label>{l}</label>{children}</div>
);

export default async function Apply({ searchParams }: { searchParams: Promise<{ kind?: string; err?: string }> }) {
  const sp = await searchParams;
  const on = (await getSetting("self_apply", "1")) === "1";
  const kind = sp.kind === "official" ? "OFFICIAL" : sp.kind === "player" ? "PLAYER" : null;
  if (!on) return <ApplyShell><div className="card"><h2>التسجيل الذاتي</h2><div className="alert warn">التسجيل الذاتي متوقف حاليًا — تواصل مع ناديك أو مع الاتحاد.</div></div></ApplyShell>;
  if (!kind)
    return (
      <ApplyShell>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>التسجيل الذاتي</h2>
          <p className="muted">قدّم بياناتك بنفسك؛ يراجعها النادي (للاعب) أو لجنة الحكام (للحكم) ثم يُستكمل القيد الرسمي. لا يُعدّ هذا الطلب قيدًا حتى يُعتمد.</p>
          <div className="row" style={{ gap: 12, marginTop: 12 }}>
            <a className="btn btn-primary" href="/apply?kind=player">⚽ أنا لاعب — أريد التسجيل في نادٍ</a>
            <a className="btn btn-gold" href="/apply?kind=official">🟨 أنا حكم — أريد الانضمام لسجل الحكام</a>
          </div>
        </div>
      </ApplyShell>
    );
  const cl = kind === "PLAYER" ? await db.select({ id: clubs.id, name: clubs.name }).from(clubs).where(eq(clubs.isActive, true)).orderBy(asc(clubs.name)) : [];
  return (
    <ApplyShell>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>{kind === "PLAYER" ? "⚽ طلب تسجيل لاعب" : "🟨 طلب انضمام حكم"}</h2>
        <p className="muted" style={{ fontSize: ".9rem" }}><a href="/apply">← رجوع</a> — الحقول المعلَّمة * إلزامية.</p>
        {sp.err && <div className="alert err">{sp.err}</div>}
        <form action={submitSelfApplication} className="form f3">
          <input type="hidden" name="kind" value={kind} />
          <div style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }} aria-hidden="true"><label>الموقع<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
          <F l="الاسم الرباعي *" full><input type="text" name="fullName" required /></F>
          <F l="الاسم بالإنجليزية (كما في الجواز)"><input type="text" name="fullNameEn" dir="ltr" /></F>
          <F l="اسم الأم"><input type="text" name="motherName" /></F>
          <F l="الجنس"><select name="gender"><option value="MALE">ذكر</option><option value="FEMALE">أنثى</option></select></F>
          <F l="تاريخ الميلاد *"><input type="date" name="dateOfBirth" required /></F>
          <F l="مكان الميلاد"><input type="text" name="placeOfBirth" /></F>
          <F l="الجنسية"><input type="text" name="nationality" defaultValue="ليبي" /></F>
          <F l="الرقم الوطني (12 رقمًا)"><input type="text" name="nationalId" inputMode="numeric" dir="ltr" maxLength={12} /></F>
          <F l="رقم الجواز (لغير الليبيين)"><input type="text" name="passportNo" dir="ltr" /></F>
          <F l="رقم الهاتف *"><input type="text" inputMode="tel" name="phone" required dir="ltr" placeholder="09xxxxxxxx" /></F>
          <F l="البريد الإلكتروني"><input type="email" name="email" dir="ltr" /></F>
          <F l="المدينة"><input type="text" name="city" /></F>
          <F l="العنوان"><input type="text" name="address" /></F>
          {kind === "PLAYER" ? <>
            <F l="النادي المطلوب *"><select name="clubId" required defaultValue=""><option value="" disabled>— اختر —</option>{cl.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></F>
            <F l="المركز"><select name="position">{Object.entries(POSITION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></F>
            <F l="وليّ الأمر (لمن هم دون 18)"><input type="text" name="guardian" placeholder="الاسم وصلة القرابة" /></F>
            <F l="نبذة (أندية سابقة، فئة عمرية…)" full><input type="text" name="experience" /></F>
          </> : <>
            <F l="الصفة *"><select name="officialType" required>{SELF_OFFICIAL_TYPES.map((k) => <option key={k} value={k}>{OFFICIAL_TYPE[k]}</option>)}</select></F>
            <F l="الخبرة والدورات (الشارة، سنوات التحكيم…)" full><input type="text" name="experience" /></F>
          </>}
          <F l="صورة شخصية حديثة * (JPG/PNG)"><input type="file" name="photo" accept="image/*" required /></F>
          <F l="صورة إثبات الهوية (اختياري)"><input type="file" name="idDoc" accept="application/pdf,image/*" /></F>
          <label className="check full"><input type="checkbox" name="consent" required /> أقرّ بصحة البيانات وأوافق على استخدامها لأغراض القيد في الاتحاد الليبي لكرة القدم</label>
          <div className="full"><Submit>إرسال الطلب</Submit></div>
        </form>
      </div>
    </ApplyShell>
  );
}
