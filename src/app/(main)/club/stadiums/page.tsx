import { eq } from "drizzle-orm";
import { db } from "@/db";
import { stadiums, clubs } from "@/db/schema";
import { requireClubUser } from "@/lib/auth";
import { stadiumBlock } from "@/lib/stadiums";
import { STADIUM_STATUS } from "@/lib/labels";
import { fmtDate, today } from "@/lib/util";
import { PageHead, Flash, Field, Badge, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { setClubStadiums } from "../../competitions/stadiums/actions";

export default async function ClubStadiums({ searchParams }: { searchParams: SP }) {
  const u = await requireClubUser("club.view");
  const sp = await searchParams;
  const [c] = await db.select().from(clubs).where(eq(clubs.id, u.clubId!));
  const all = await db.select().from(stadiums).orderBy(stadiums.city, stadiums.name);
  const t = today();
  const usable = all.filter((s) => !stadiumBlock(s, t));
  const main = all.find((s) => s.id === c.mainStadiumId), backup = all.find((s) => s.id === c.backupStadiumId);
  const card = (label: string, s?: (typeof all)[number]) => (
    <div className="card">
      <div className="muted">{label}</div>
      {s ? <>
        <h3 style={{ margin: ".2rem 0" }}>{s.name}</h3>
        <div>{s.city}{s.capacity ? ` — ${s.capacity.toLocaleString("en")} متفرج` : ""} — <Badge v={STADIUM_STATUS[s.status]} /></div>
        {s.approvalUntil && <div className="muted">الاعتماد حتى {fmtDate(s.approvalUntil)}</div>}
        {stadiumBlock(s, t) && <div className="danger-text">⛔ {stadiumBlock(s, t)}</div>}
      </> : <p className="danger-text">لم يُحدد بعد</p>}
    </div>
  );
  return (
    <>
      <PageHead title="ملاعب النادي" sub="المادة 26 من لائحة المسابقات: يسمي النادي الملعب الذي تقام عليه مبارياته والملعب البديل" />
      <Flash sp={sp} />
      <div className="grid g2">{card("الملعب الأساسي", main)}{card("الملعب الاحتياطي (البديل)", backup)}</div>
      {u.can("club.edit") && (
        <form action={setClubStadiums} className="card form f2">
          <h3 className="full">تحديد الملعبين</h3>
          <Field label="الملعب الأساسي *"><select name="mainStadiumId" defaultValue={c.mainStadiumId ?? ""} required><option value="">—</option>{usable.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.city}</option>)}</select></Field>
          <Field label="الملعب الاحتياطي"><select name="backupStadiumId" defaultValue={c.backupStadiumId ?? ""}><option value="">—</option>{usable.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.city}</option>)}</select></Field>
          <p className="muted full" style={{ fontSize: ".85rem" }}>تظهر الملاعب المعتمدة في سجل الملاعب فقط. إذا لم يكن ملعبكم مسجلًا، راسلوا لجنة المسابقات لتسجيله ومعاينته. وللجنة الحق في إقامة مبارياتكم على ملعب آخر عند الضرورة.</p>
          <div className="full"><Submit>حفظ</Submit></div>
        </form>
      )}
    </>
  );
}
