import { desc, eq, or, inArray, isNull, and } from "drizzle-orm";
import { db } from "@/db";
import { seasons, registrationWindows, ageCategories, documentTypes, clubs, settings, divisions } from "@/db/schema";
import { scopeOf } from "@/lib/scope";
import { requireUser } from "@/lib/auth";
import { REG_TYPE } from "@/lib/labels";
import { fmtDate, today } from "@/lib/util";
import { PageHead, Flash, Field, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import {
  saveSeason, setCurrentSeason, closeSeason, saveWindow, toggleWindow, deleteWindow, saveCategory, saveDocType, saveRegSettings,
} from "../actions";

export default async function RegSettings({ searchParams }: { searchParams: SP }) {
  const u = await requireUser("reg.windows");
  const sp = await searchParams;
  const sc = await scopeOf(u);
  const ids = sc?.clubIds.length ? sc.clubIds : [-1];
  // مدير الدرجة: فترات درجته وأنديتها، مع عرض الفترات العامة للاطلاع
  const wWhere = sc ? or(eq(registrationWindows.divisionId, sc.divisionId), inArray(registrationWindows.clubId, ids), and(isNull(registrationWindows.divisionId), isNull(registrationWindows.clubId))) : undefined;
  const dv = await db.select({ id: divisions.id, name: divisions.name }).from(divisions).orderBy(divisions.level);
  const [ss, ws, cats, dts, cl, origin] = await Promise.all([
    db.select().from(seasons).orderBy(desc(seasons.startDate)),
    db.select({ w: registrationWindows, club: clubs.name }).from(registrationWindows).leftJoin(clubs, eq(clubs.id, registrationWindows.clubId)).where(wWhere).orderBy(desc(registrationWindows.startDate)),
    db.select().from(ageCategories).orderBy(ageCategories.sortOrder),
    db.select().from(documentTypes).orderBy(documentTypes.sortOrder),
    db.select({ id: clubs.id, name: clubs.name }).from(clubs).where(sc ? inArray(clubs.id, ids) : undefined).orderBy(clubs.name),
    db.select().from(settings).where(eq(settings.key, "require_origin_consent")),
  ]);
  const t = today();
  const status = (w: (typeof ws)[number]["w"]) =>
    w.isClosed ? <span className="b b-gray">مغلقة يدويًا</span> : w.startDate <= t && w.endDate >= t ? <span className="b b-green">مفتوحة الآن</span> : w.startDate > t ? <span className="b b-blue">قادمة</span> : <span className="b b-gray">منتهية</span>;
  const WinFields = ({ w }: { w?: (typeof ws)[number]["w"] }) => (
    <>
      <Field label="الموسم"><select name="seasonId" defaultValue={w?.seasonId ?? ss.find((s) => s.isCurrent)?.id}>{ss.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      <Field label="اسم الفترة"><input type="text" name="label" required defaultValue={w?.label} placeholder="الفترة الصيفية / الشتوية" /></Field>
      {!sc && <Field label="الدرجة"><select name="divisionId" defaultValue={w?.divisionId ?? ""}><option value="">كل الدرجات</option>{dv.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>}
      <Field label="خاصة بنادٍ (استثناء)"><select name="clubId" defaultValue={w?.clubId ?? ""}><option value="">{sc ? `كل أندية ${sc.divisionName}` : "— لا (حسب الدرجة) —"}</option>{cl.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="من"><input type="date" name="startDate" required defaultValue={w?.startDate ?? t} /></Field>
      <Field label="إلى"><input type="date" name="endDate" required defaultValue={w?.endDate} /></Field>
      <Field label="فترة استثنائية"><label className="check"><input type="checkbox" name="isException" defaultChecked={w?.isException} /> نعم</label></Field>
    </>
  );
  return (
    <>
      <PageHead title={sc ? `فترات القيد — ${sc.divisionName}` : "المواسم وفترات القيد"} sub={sc ? "فتح وإغلاق فترات التسجيل والانتقالات لأندية درجتك" : "فتح وإغلاق فترات التسجيل والانتقالات لكل درجة، الفئات العمرية، والمستندات المطلوبة"} />
      <Flash sp={sp} />

      <div className="card">
        <h2>فترات القيد والانتقالات</h2>
        <p className="muted">لا تستطيع الأندية إرسال الطلبات إلا خلال فترة مفتوحة لدرجتها (أو فترة عامة لكل الدرجات). يمكن فتح فترة استثنائية لنادٍ واحد.</p>
        <div className="table-wrap">
          <table className="t"><thead><tr><th>الفترة</th><th>الموسم</th><th>من</th><th>إلى</th><th>تشمل</th><th>الحالة</th><th></th></tr></thead>
            <tbody>{ws.map(({ w, club }) => (
              <tr key={w.id}><td><strong>{w.label}</strong>{w.isException && <span className="b b-purple" style={{ marginInlineStart: 6 }}>استثنائية</span>}</td>
                <td>{ss.find((s) => s.id === w.seasonId)?.name}</td><td>{fmtDate(w.startDate)}</td><td>{fmtDate(w.endDate)}</td><td>{club ? `نادي: ${club}` : w.divisionId ? <span className="b b-indigo">{dv.find((x) => x.id === w.divisionId)?.name}</span> : <span className="b b-gray">كل الدرجات</span>}</td><td>{status(w)}</td>
                <td className="btn-row">{(!sc || w.clubId || w.divisionId === sc.divisionId) ? <>
                  <form action={toggleWindow}><input type="hidden" name="id" value={w.id} /><Submit className="btn btn-sm btn-light">{w.isClosed ? "إعادة فتح" : "إغلاق الآن"}</Submit></form>
                  <details><summary className="btn btn-sm btn-light">تعديل</summary>
                    <form action={saveWindow} className="form f1 mt" style={{ minWidth: 300 }}>
                      <input type="hidden" name="id" value={w.id} />
                      <WinFields w={w} />
                      <Submit className="btn btn-sm">حفظ</Submit>
                    </form></details>
                  <form action={deleteWindow}><input type="hidden" name="id" value={w.id} /><Submit className="btn btn-sm btn-ghost" confirm="حذف الفترة؟">حذف</Submit></form>
                </> : <span className="muted" style={{ fontSize: ".8rem" }}>يديرها الاتحاد</span>}</td></tr>
            ))}</tbody></table>
        </div>
        <details className="box mt"><summary>+ فتح فترة جديدة</summary>
          <form action={saveWindow} className="form f3 mt">
            <WinFields />
            <div className="full"><Submit>حفظ الفترة</Submit></div>
          </form>
        </details>
      </div>

      {!sc && <>
      <div className="card">
        <h2>المواسم</h2>
        <div className="table-wrap">
          <table className="t"><thead><tr><th>الموسم</th><th>من</th><th>إلى</th><th>الحالة</th><th></th></tr></thead>
            <tbody>{ss.map((s) => (
              <tr key={s.id}><td><strong>{s.name}</strong></td><td>{fmtDate(s.startDate)}</td><td>{fmtDate(s.endDate)}</td>
                <td>{s.isCurrent ? <span className="b b-green">الموسم الحالي</span> : ""}</td>
                <td className="btn-row">
                  {!s.isCurrent && <form action={setCurrentSeason}><input type="hidden" name="id" value={s.id} /><Submit className="btn btn-sm btn-light" confirm="تعيين كموسم حالي؟ ستُنشأ الطلبات الجديدة عليه.">تعيين كحالي</Submit></form>}
                  {!s.isCurrent && <form action={closeSeason}><input type="hidden" name="id" value={s.id} /><Submit className="btn btn-sm btn-ghost" confirm="إغلاق الموسم؟ ستصبح كل قيوده المعتمدة منتهية.">إغلاق الموسم</Submit></form>}
                </td></tr>
            ))}</tbody></table>
        </div>
        <details className="box mt"><summary>+ موسم جديد</summary>
          <form action={saveSeason} className="form f3 mt">
            <Field label="الاسم"><input type="text" name="name" required placeholder="2027-2028" dir="ltr" /></Field>
            <Field label="البداية"><input type="date" name="startDate" required /></Field>
            <Field label="النهاية"><input type="date" name="endDate" required /></Field>
            <div className="full"><Submit>إضافة</Submit></div>
          </form>
        </details>
      </div>

      <div className="grid g2">
        <div className="card" id="cats">
          <h2>الفئات العمرية</h2>
          <p className="muted">تُحسب الفئة تلقائيًا: (سنة بداية الموسم − سنة الميلاد) ≤ الحد الأقصى. الفئة بلا حد = الفريق الأول.<br />خانة «أجانب»: الحد الأقصى للاعبين الأجانب الذين يحق لكل نادٍ التعاقد معهم في هذه الفئة (فارغة = بلا حد).</p>
          {cats.map((c) => (
            <form key={c.id} action={saveCategory} className="row" style={{ marginBottom: ".4rem" }}>
              <input type="hidden" name="id" value={c.id} />
              <input type="text" name="name" defaultValue={c.name} style={{ flex: 2 }} />
              <input type="number" name="maxAge" defaultValue={c.maxAge ?? ""} placeholder="بلا حد" style={{ width: 80 }} title="الحد الأقصى للعمر" />
              <input type="number" name="maxForeign" defaultValue={c.maxForeign ?? ""} placeholder="أجانب ∞" style={{ width: 90 }} title="الحد الأقصى للتعاقد مع الأجانب لكل نادٍ" />
              <input type="number" name="sortOrder" defaultValue={c.sortOrder} style={{ width: 60 }} title="الترتيب" />
              <Submit className="btn btn-sm btn-light">حفظ</Submit>
            </form>
          ))}
          <form action={saveCategory} className="row mt">
            <input type="text" name="name" placeholder="فئة جديدة" required style={{ flex: 2 }} />
            <input type="number" name="maxAge" placeholder="العمر" style={{ width: 80 }} />
            <input type="number" name="maxForeign" placeholder="أجانب" style={{ width: 90 }} />
            <input type="number" name="sortOrder" placeholder="ترتيب" style={{ width: 60 }} />
            <Submit className="btn btn-sm btn-primary">إضافة</Submit>
          </form>
        </div>

        <div className="card">
          <h2>إعدادات القيد</h2>
          <form action={saveRegSettings} className="stack">
            <label className="check"><input type="checkbox" name="require_origin_consent" defaultChecked={(origin[0]?.value ?? "1") === "1"} /> طلب رأي النادي السابق في الانتقال والإعارة</label>
            <div><Submit>حفظ</Submit></div>
          </form>
        </div>
      </div>

      <div className="card" id="docs">
        <h2>المستندات المطلوبة</h2>
        <p className="muted">حدّد لكل مستند أنواع الطلبات التي يُلزم فيها. لا يستطيع النادي إرسال الطلب قبل رفع كل الإلزامي.</p>
        {[...dts, null].map((d) => (
          <details key={d?.id ?? "new"} className="box" open={!d ? false : undefined}>
            <summary>{d ? <>{d.name} {!d.isActive && <span className="b b-gray">معطّل</span>} <small className="muted">— {d.requiredFor.map((x) => REG_TYPE[x]).join("، ") || "اختياري"}</small></> : "+ نوع مستند جديد"}</summary>
            <form action={saveDocType} className="stack mt">
              {d && <input type="hidden" name="id" value={d.id} />}
              <div className="row"><input type="text" name="name" defaultValue={d?.name} placeholder="اسم المستند" required style={{ flex: 1 }} />
                <input type="number" name="sortOrder" defaultValue={d?.sortOrder ?? 0} style={{ width: 80 }} title="الترتيب" /></div>
              <div className="chk-grid">
                {Object.entries(REG_TYPE).map(([k, v]) => <label key={k} className="check"><input type="checkbox" name="requiredFor" value={k} defaultChecked={d?.requiredFor.includes(k)} /> إلزامي في: {v}</label>)}
                <label className="check"><input type="checkbox" name="onlyProfessional" defaultChecked={d?.onlyProfessional} /> للمحترف/تحت العقد فقط</label>
                <label className="check"><input type="checkbox" name="onlyMinor" defaultChecked={d?.onlyMinor} /> لمن هم دون 18 فقط</label>
                <label className="check"><input type="checkbox" name="onlyForeign" defaultChecked={d?.onlyForeign} /> للأجانب فقط</label>
                <label className="check"><input type="checkbox" name="isActive" defaultChecked={d?.isActive ?? true} /> مفعّل</label>
              </div>
              <div><Submit className="btn btn-sm btn-primary">حفظ</Submit></div>
            </form>
          </details>
        ))}
      </div>
      </>}
    </>
  );
}
