import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { matches, matchSquads, competitions } from "@/db/schema";
import { clubEligibility } from "./eligibility";
import { int, UserError } from "./util";

/** منطق مشترك لحفظ القائمة (النادي ولجنة المسابقات) */
export async function saveLineup(matchId: number, clubId: number, f: FormData) {
  const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
  const [c] = await db.select().from(competitions).where(eq(competitions.id, m.competitionId));
  const on = (m.kickoff ?? new Date()).toISOString().slice(0, 10);
  const elig = await clubEligibility(clubId, m.competitionId, on);
  const chosen = f.getAll("player").map(Number);
  const starters = new Set(f.getAll("starter").map(Number));
  const captain = int(f, "captain");
  const rows = chosen.map((pid) => {
    const e = elig.find((x) => x.playerId === pid);
    if (!e) throw new UserError("لاعب غير مقيد لدى النادي في موسم المسابقة");
    if (!e.ok) throw new UserError(`${e.fullName}: غير مؤهل — ${e.reasons.join("، ")}`);
    return { e, starter: starters.has(pid) };
  });
  if (rows.length > c.squadMax) throw new UserError(`الحد الأقصى للقائمة ${c.squadMax} لاعبًا`);
  const st = rows.filter((r) => r.starter).length;
  if (rows.length && st !== c.startersCount) throw new UserError(`عدد الأساسيين يجب أن يكون ${c.startersCount} (المحدد: ${st})`);
  if (c.maxForeign != null) {
    const fo = rows.filter((r) => r.e.isForeign).length;
    if (fo > c.maxForeign) throw new UserError(`عدد الأجانب في القائمة (${fo}) يتجاوز الحد المسموح (${c.maxForeign})`);
  }
  if (c.maxForeignOnPitch != null) {
    const fs = rows.filter((r) => r.e.isForeign && r.starter).length;
    if (fs > c.maxForeignOnPitch) throw new UserError(`عدد الأجانب الأساسيين داخل الملعب (${fs}) يتجاوز الحد المسموح (${c.maxForeignOnPitch})`);
  }
  const nums = rows.map((r) => int(f, `num_${r.e.playerId}`) ?? r.e.shirtNumber).filter((n) => n != null);
  if (new Set(nums).size !== nums.length) throw new UserError("أرقام قمصان مكررة في القائمة");
  await db.transaction(async (tx) => {
    await tx.delete(matchSquads).where(and(eq(matchSquads.matchId, matchId), eq(matchSquads.clubId, clubId)));
    if (rows.length)
      await tx.insert(matchSquads).values(
        rows.map((r) => ({
          matchId, clubId, playerId: r.e.playerId, registrationId: r.e.registrationId, isStarter: r.starter,
          isCaptain: captain === r.e.playerId, shirtNumber: int(f, `num_${r.e.playerId}`) ?? r.e.shirtNumber,
        })),
      );
  });
}

