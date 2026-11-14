import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { roundDecisions, competitions } from "@/db/schema";
import { DecisionDoc } from "@/components/DecisionDoc";

export const dynamic = "force-dynamic";
export const metadata = { title: "قرار لجنة تنظيم المسابقات" };

/** القرار الصادر في الموقع العام (تُخفى أرقام البطاقات الرياضية) */
export default async function PublicDecision({ params }: { params: Promise<{ did: string }> }) {
  const id = Number((await params).did);
  if (!Number.isInteger(id)) notFound();
  const [d] = await db.select().from(roundDecisions).where(eq(roundDecisions.id, id));
  if (!d || d.status !== "ISSUED") notFound();
  const [c] = await db.select().from(competitions).where(eq(competitions.id, d.competitionId));
  if (!c?.isPublic) notFound();
  return (
    <>
      <div className="lg-crumb no-print"><Link href="/league">المسابقات</Link> / <Link href={`/league/${c.id}?tab=decisions`}>{c.name}</Link> / القرار ({d.number})</div>
      <DecisionDoc d={d} publicView />
    </>
  );
}
