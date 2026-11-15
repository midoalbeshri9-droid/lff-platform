import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { selfApplications } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { appUrl } from "@/lib/tokens";
import { PageHead, Flash, type SP } from "@/components/ui";
import { SelfAppsList } from "@/components/SelfApps";
import { acceptOfficialApp, rejectOfficialApp } from "../../club/applications/actions";

/** طلبات الانضمام لسجل الحكام المقدّمة ذاتيًا */
export default async function RefApplications({ searchParams }: { searchParams: SP }) {
  const u = await requireUser("ref.view");
  const sp = await searchParams;
  const st = sp.status ?? "NEW";
  const rows = await db.select().from(selfApplications)
    .where(and(eq(selfApplications.kind, "OFFICIAL"), st === "ALL" ? undefined : eq(selfApplications.status, st)))
    .orderBy(desc(selfApplications.id)).limit(300);
  return (
    <>
      <PageHead title="طلبات انضمام الحكام" sub="مقدّمة ذاتيًا من الصفحة العامة — القبول يضيف الحكم بالدرجة الثالثة لاستكمال بياناته" />
      <Flash sp={sp} />
      <div className="box card" style={{ fontSize: ".88rem" }}>رابط التقديم: <code dir="ltr">{appUrl() + "/apply?kind=official"}</code></div>
      <div className="tag-list" style={{ marginBottom: 10 }}>{[["NEW", "جديدة"], ["ACCEPTED", "مقبولة"], ["REJECTED", "مرفوضة"], ["ALL", "الكل"]].map(([k, l]) => <a key={k} className={`b ${st === k ? "b-blue" : "b-gray"}`} href={`?status=${k}`}>{l}</a>)}</div>
      <div className="card table-wrap"><SelfAppsList rows={rows} can={u.can("ref.manage")} accept={acceptOfficialApp} reject={rejectOfficialApp}
        extra={(a) => a.officialId ? <div><a href={`/referees/${a.officialId}`}>← سجل الحكم</a></div> : null} /></div>
    </>
  );
}
