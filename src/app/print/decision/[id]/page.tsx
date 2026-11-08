import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { roundDecisions } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { inScopeComp } from "@/lib/scope";
import { decisionClubs } from "@/lib/decisions";
import { DecisionDoc } from "@/components/DecisionDoc";

/** قالب طباعة قرار لجنة تنظيم المسابقات للجولة — على نمط قرارات اللجنة الورقية */
export default async function DecisionPrint({ params }: { params: Promise<{ id: string }> }) {
  const u = await getCurrentUser();
  if (!u || u.isOfficial) redirect("/denied");
  const [d] = await db.select().from(roundDecisions).where(eq(roundDecisions.id, Number((await params).id)));
  if (!d) redirect("/denied");
  if (u.isClub) {
    // النادي يطّلع على القرار الصادر الذي يخص مبارياته
    if (d.status !== "ISSUED" || !(await decisionClubs(d)).some((x) => x.id === u.clubId)) redirect("/denied");
  } else if (!u.can("comp.view") || !(await inScopeComp(u, d.competitionId))) redirect("/denied");
  return <DecisionDoc d={d} />;
}
