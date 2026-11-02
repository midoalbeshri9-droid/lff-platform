import { eq, or, ilike, desc } from "drizzle-orm";
import { db } from "@/db";
import { players, registrations, clubs, seasons } from "@/db/schema";
import { requireClubUser } from "@/lib/auth";
import { REG_STATUS, REG_TYPE } from "@/lib/labels";
import { fmtDate } from "@/lib/util";
import { PageHead, Flash, Badge, Field, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { PlayerFields } from "@/components/PlayerForm";
import { createPlayerAndRequest, requestExisting } from "../../actions";

export default async function NewPlayer({ searchParams }: { searchParams: SP }) {
  await requireClubUser("club.edit");
  const sp = await searchParams;
  const q = sp.q?.trim();
  const found = q
    ? await db.select().from(players).where(
        /^\d+$/.test(q) && q.length < 8 ? eq(players.id, Number(q)) : or(eq(players.nationalId, q), eq(players.passportNo, q), ilike(players.fullName, q)),
      ).limit(5)
    : [];
  const history = found.length
    ? await db
        .select({ r: registrations, club: clubs.name, season: seasons.name })
        .from(registrations)
        .innerJoin(clubs, eq(clubs.id, registrations.clubId))
        .innerJoin(seasons, eq(seasons.id, registrations.seasonId))
        .where(or(...found.map((p) => eq(registrations.playerId, p.id))))
        .orderBy(desc(registrations.id))
    : [];

  return (
    <>
      <PageHead title="إضافة لاعب / طلب قيد" crumbs={[["لاعبو النادي", "/club/players"], ["إضافة"]]} />
      <Flash sp={sp} />
      <div className="card">
        <h2>1) ابحث أولًا عن اللاعب</h2>
        <p className="muted">ابحث بالرقم الوطني أو رقم الجواز. إذا كان اللاعب مسجلًا في المنظومة (لدى أي نادٍ) ستُنشئ طلب تجديد أو انتقال أو إعارة بدل تسجيله من جديد.</p>
        <form className="filters" style={{ marginBottom: 0 }}>
          <div className="field grow"><label>الرقم الوطني / الجواز</label><input type="search" name="q" dir="ltr" defaultValue={q} required /></div>
          <button className="btn btn-primary">بحث</button>
        </form>
      </div>

      {q && found.map((p) => (
        <div className="card" key={p.id}>
          <div className="card-head"><h2>✓ اللاعب مسجل في المنظومة: {p.fullName}</h2></div>
          <dl className="dl">
            <dt>الرقم الوطني</dt><dd className="kbd">{p.nationalId ?? "—"}</dd>
            <dt>تاريخ الميلاد</dt><dd>{fmtDate(p.dateOfBirth)}</dd>
          </dl>
          <h3 className="mt">سجل القيد</h3>
          <table className="t"><tbody>
            {history.filter((h) => h.r.playerId === p.id).map((h) => (
              <tr key={h.r.id}><td>{h.season}</td><td>{h.club}</td><td>{REG_TYPE[h.r.type]}</td><td><Badge v={REG_STATUS[h.r.status]} /></td></tr>
            ))}
          </tbody></table>
          <form action={requestExisting} className="form mt">
            <input type="hidden" name="playerId" value={p.id} />
            <Field label="نوع الطلب" hint="يحدد النظام النوع الصحيح تلقائيًا حسب وضع اللاعب">
              <select name="type" defaultValue="RENEWAL">
                <option value="RENEWAL">تجديد قيد (لاعب لدى ناديكم سابقًا)</option>
                <option value="TRANSFER">انتقال نهائي من نادٍ آخر</option>
                <option value="LOAN">إعارة من نادٍ آخر</option>
                <option value="LOAN_RETURN">عودة من إعارة</option>
              </select>
            </Field>
            <Field label="نهاية الإعارة (للإعارة فقط)"><input type="date" name="loanEndDate" /></Field>
            <div className="full"><Submit>إنشاء الطلب</Submit></div>
          </form>
        </div>
      ))}

      {q && found.length === 0 && (
        <div className="card">
          <h2>2) لاعب جديد — غير مسجل في المنظومة</h2>
          <form action={createPlayerAndRequest} className="form">
            <PlayerFields p={{ nationalId: /^\d{12}$/.test(q) ? q : null, passportNo: /^\d{12}$/.test(q) ? null : q }} photoRequired />
            <Field label="رقم القميص"><input type="number" name="shirtNumber" min={1} max={99} /></Field>
            <div className="full"><Submit>حفظ كمسودة والانتقال لرفع المستندات</Submit></div>
          </form>
        </div>
      )}
    </>
  );
}
