import "server-only";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { suspensions, registrations, players, competitions, sanctions, staff, matches } from "@/db/schema";
import { today } from "./util";

export type SuspendedRow = { kind: "PLAYER" | "STAFF"; id: number; name: string; shirt: number | null; reason: string; left: string; comp: string | null };

/** الموقوفون حاليًا من نادٍ (لاعبون بإيقاف لم يُستوفَ + مرافقون بعقوبة إيقاف سارية) — لتنبيه النادي قبل الجولة */
export async function clubSuspended(clubId: number, seasonId: number): Promise<SuspendedRow[]> {
  const t = today();
  const regs = await db.select({ pid: registrations.playerId, shirt: registrations.shirtNumber, name: players.fullName }).from(registrations)
    .innerJoin(players, eq(players.id, registrations.playerId))
    .where(and(eq(registrations.clubId, clubId), eq(registrations.seasonId, seasonId), eq(registrations.status, "APPROVED")));
  const out: SuspendedRow[] = [];
  if (regs.length) {
    const rows = await db.select({ s: suspensions, comp: competitions.name }).from(suspensions).leftJoin(competitions, eq(competitions.id, suspensions.competitionId))
      .where(and(inArray(suspensions.playerId, regs.map((r) => r.pid)), eq(suspensions.isLifted, false)));
    for (const { s, comp } of rows) {
      const active = s.kind === "ADMIN" ? !s.endDate || s.endDate >= t : (s.matchesTotal ?? 0) > s.matchesServed;
      if (!active) continue;
      const r = regs.find((x) => x.pid === s.playerId)!;
      out.push({ kind: "PLAYER", id: s.playerId, name: r.name, shirt: r.shirt, reason: s.reason, comp,
        left: s.kind === "MATCHES" ? `${(s.matchesTotal ?? 0) - s.matchesServed} من ${s.matchesTotal} مباراة` : s.endDate ? `حتى ${s.endDate}` : "حتى إشعار آخر" });
    }
  }
  const st = await db.select({ x: sanctions, name: staff.fullName }).from(sanctions).innerJoin(staff, eq(staff.id, sanctions.staffId))
    .where(and(eq(sanctions.clubId, clubId), eq(sanctions.targetType, "STAFF"), inArray(sanctions.type, ["MATCH_BAN", "TIME_BAN"]), inArray(sanctions.status, ["ACTIVE", "APPEALED"])));
  for (const { x, name } of st) {
    if (x.toDate && x.toDate < t) continue;
    let left = x.toDate ? `حتى ${x.toDate}` : `قرار ${x.number}`;
    if (x.type === "MATCH_BAN" && x.matchesCount) {
      // مباريات النادي المعتمدة بعد تاريخ القرار تُحتسب من الإيقاف
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(matches)
        .where(and(or(eq(matches.homeClubId, clubId), eq(matches.awayClubId, clubId)), eq(matches.reportStatus, "APPROVED"), sql`${matches.kickoff}::date > ${x.decisionDate}::date`));
      const rem = x.matchesCount - n;
      if (rem <= 0) continue;
      left = `${rem} من ${x.matchesCount} مباراة (قرار ${x.number})`;
    }
    out.push({ kind: "STAFF", id: x.staffId!, name, shirt: null, reason: x.reason, comp: null, left });
  }
  return out;
}
