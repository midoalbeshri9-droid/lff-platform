import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { selfApplications } from "@/db/schema";
import { requireClubUser } from "@/lib/auth";
import { appUrl } from "@/lib/tokens";
import { PageHead, Flash, type SP } from "@/components/ui";
import { SelfAppsList } from "@/components/SelfApps";
import { acceptPlayerApp, rejectPlayerApp } from "./actions";

/** طلبات التسجيل الذاتي التي قدّمها لاعبون لهذا النادي */
export default async function ClubApplications({ searchParams }: { searchParams: SP }) {
  const u = await requireClubUser();
  const sp = await searchParams;
  const st = sp.status ?? "NEW";
  const rows = await db.select().from(selfApplications)
    .where(and(eq(selfApplications.kind, "PLAYER"), eq(selfApplications.clubId, u.clubId), st === "ALL" ? undefined : eq(selfApplications.status, st)))
    .orderBy(desc(selfApplications.id)).limit(300);
  return (
    <>
      <PageHead title="طلبات التسجيل الذاتي" sub="لاعبون قدّموا بياناتهم بأنفسهم واختاروا ناديكم — القبول ينشئ اللاعب وطلب قيد جديد كمسودة" />
      <Flash sp={sp} />
      <div className="box card" style={{ fontSize: ".88rem" }}>رابط التسجيل للاعبين (شاركه على صفحة النادي): <code dir="ltr">{appUrl() + "/apply?kind=player"}</code></div>
      <div className="tag-list" style={{ marginBottom: 10 }}>{[["NEW", "جديدة"], ["ACCEPTED", "مقبولة"], ["REJECTED", "مرفوضة"], ["ALL", "الكل"]].map(([k, l]) => <a key={k} className={`b ${st === k ? "b-blue" : "b-gray"}`} href={`?status=${k}`}>{l}</a>)}</div>
      <div className="card table-wrap"><SelfAppsList rows={rows} can={u.can("club.edit")} accept={acceptPlayerApp} reject={rejectPlayerApp}
        extra={(a) => a.registrationId ? <div><a href={`/club/registrations/${a.registrationId}`}>← طلب القيد</a></div> : null} /></div>
    </>
  );
}
