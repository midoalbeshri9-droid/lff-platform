import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { competitions, competitionTeams, registrations, players, competitionSquads, ageCategories } from "@/db/schema";
import { requireClubUser } from "@/lib/auth";
import { POSITION } from "@/lib/labels";
import { PageHead, Flash, type SP } from "@/components/ui";
import { SquadListForm } from "@/components/SquadList";

export default async function ClubSquad({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const u = await requireClubUser("club.view");
  const id = Number((await params).id);
  const sp = await searchParams;
  const [c] = await db.select().from(competitions).where(eq(competitions.id, id));
  const [team] = await db.select().from(competitionTeams).where(and(eq(competitionTeams.competitionId, id), eq(competitionTeams.clubId, u.clubId)));
  if (!c || !team) notFound();
  const regs = await db.select({ p: players, num: registrations.number, cat: ageCategories.name }).from(registrations).innerJoin(players, eq(players.id, registrations.playerId))
    .leftJoin(ageCategories, eq(ageCategories.id, registrations.categoryId))
    .where(and(eq(registrations.clubId, u.clubId), eq(registrations.seasonId, c.seasonId), eq(registrations.status, "APPROVED"))).orderBy(players.fullName);
  const chosen = new Set((await db.select().from(competitionSquads).where(and(eq(competitionSquads.competitionId, id), eq(competitionSquads.clubId, u.clubId)))).map((x) => x.playerId));
  return (
    <>
      <PageHead title={`قائمة الموسم — ${c.name}`} sub={c.squadListMax != null ? `الحد الأقصى ${c.squadListMax} لاعبًا — لا تُختار قائمة أي مباراة إلا منها` : "هذه المسابقة لا تتطلب قائمة موسم"} crumbs={[["المباريات", "/club/matches"], [c.name]]} />
      <Flash sp={sp} />
      {c.squadListMax != null && <SquadListForm competitionId={id} max={c.squadListMax} maxForeign={c.maxForeign} readOnly={!u.can("club.lineups")}
        rows={regs.map((r) => ({ id: r.p.id, name: r.p.fullName, num: r.num, cat: r.cat, pos: POSITION[r.p.position], foreign: r.p.isForeign, checked: chosen.has(r.p.id) }))} />}
    </>
  );
}
