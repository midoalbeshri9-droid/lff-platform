import Link from "next/link";
import { and, eq, desc } from "drizzle-orm";
import { db } from "@/db";
import { staff, sanctions } from "@/db/schema";
import { requireClubUser } from "@/lib/auth";
import { getCurrentSeason } from "@/lib/registration";
import { REG_STATUS, STAFF_ROLE, STAFF_GROUP, staffGroup, COACH_LEVEL } from "@/lib/labels";
import { fileUrl } from "@/lib/storage";
import { PageHead, Flash, Badge, Field, Empty, type SP } from "@/components/ui";
import { Submit } from "@/components/Client";
import { createStaff } from "./actions";

/** المدربون والإداريون — كما في FIFA Connect: الدور (مدرب / إداري نادٍ) ثم الصفة الفرعية */
export default async function ClubStaff({ searchParams }: { searchParams: SP }) {
  const u = await requireClubUser("club.view");
  const sp = await searchParams;
  const season = await getCurrentSeason();
  const rows = await db.select().from(staff).where(and(eq(staff.clubId, u.clubId), eq(staff.seasonId, season?.id ?? 0))).orderBy(staff.role, staff.fullName);
  const bans = await db.select().from(sanctions).where(and(eq(sanctions.clubId, u.clubId), eq(sanctions.targetType, "STAFF"), eq(sanctions.status, "ACTIVE"))).orderBy(desc(sanctions.id));
  const table = (g: "COACH" | "OFFICIAL") => {
    const list = rows.filter((s) => staffGroup(s.role) === g);
    return (
      <div className="card table-wrap" key={g}>
        <h3>{g === "COACH" ? "🧢 الجهاز الفني" : "🗂 إداريو النادي"} ({list.length})</h3>
        {list.length === 0 ? <Empty>لا يوجد</Empty> : (
          <table className="t"><thead><tr><th></th><th>الاسم</th><th>الصفة</th>{g === "COACH" && <><th>المستوى</th><th>الرخصة</th></>}<th>الحالة</th><th></th></tr></thead>
            <tbody>{list.map((s) => (
              <tr key={s.id}>
                <td>{s.photoKey ? <img className="thumb" src={fileUrl(s.photoKey)!} alt="" /> : <span className="ph">👤</span>}</td>
                <td><strong>{s.fullName}</strong>{s.decisionReason && s.status !== "APPROVED" && <div className="danger-text" style={{ fontSize: ".8rem" }}>{s.decisionReason}</div>}</td>
                <td>{STAFF_ROLE[s.role]}</td>
                {g === "COACH" && <><td>{s.level ? COACH_LEVEL[s.level] : "—"}</td><td>{s.licenseLevel ?? "—"}{s.licenseUntil && <div className="muted" style={{ fontSize: ".75rem" }}>حتى {s.licenseUntil}</div>}</td></>}
                <td><Badge v={REG_STATUS[s.status]} /></td>
                <td><Link className="btn btn-sm btn-light" href={`/club/staff/${s.id}`}>{["DRAFT", "NEEDS_CORRECTION"].includes(s.status) && u.can("club.edit") ? "استكمال / إرسال" : "عرض"}</Link></td>
              </tr>))}</tbody></table>
        )}
      </div>
    );
  };
  return (
    <>
      <PageHead title="المدربون والإداريون" sub={`الموسم ${season?.name ?? ""} — يُعتمدون من لجنة القيد`} />
      <Flash sp={sp} />
      {bans.length > 0 && <div className="alert err">عقوبات سارية على إداريين: {bans.map((b) => `${b.number}: ${b.reason}`).join(" — ")}</div>}
      {u.can("club.edit") && (
        <details className="box card" open={rows.length === 0}>
          <summary>+ إضافة مدرب / إداري</summary>
          <form action={createStaff} className="form f3 mt">
            <Field label="الدور والصفة *"><select name="role" required defaultValue="">
              <option value="" disabled>اختر</option>
              {(["COACH", "OFFICIAL"] as const).map((g) => <optgroup key={g} label={STAFF_GROUP[g].label}>{STAFF_GROUP[g].roles.map((r) => <option key={r} value={r}>{STAFF_ROLE[r]}</option>)}</optgroup>)}
            </select></Field>
            <Field label="الرقم الوطني / رقم الجواز" hint="إن كان الشخص مسجّلًا مسبقًا (مدربًا أو لاعبًا) تُنقل بياناته تلقائيًا"><input name="nationalId" dir="ltr" /></Field>
            <Field label="الاسم الكامل"><input name="fullName" /></Field>
            <div className="full"><Submit>متابعة ←</Submit></div>
          </form>
        </details>
      )}
      {table("COACH")}
      {table("OFFICIAL")}
    </>
  );
}
