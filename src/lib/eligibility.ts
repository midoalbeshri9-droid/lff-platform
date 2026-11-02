import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { registrations, players, ageCategories, competitions, suspensions, competitionSquads } from "@/db/schema";

export type EligibilityRow = {
  playerId: number;
  registrationId: number;
  number: string | null;
  fullName: string;
  shirtNumber: number | null;
  isForeign: boolean;
  categoryName: string | null;
  ok: boolean;
  reasons: string[];
};

/**
 * فحص أهلية كل لاعبي نادٍ لمسابقة في تاريخ معيّن — هذا هو الرابط بين لجنة القيد ولجنة المسابقات:
 * لا يُقبل في قائمة المباراة إلا لاعب قيده معتمد في موسم المسابقة، غير موقوف، ومن الفئة العمرية المناسبة.
 */
export async function clubEligibility(clubId: number, competitionId: number, on: string): Promise<EligibilityRow[]> {
  const [comp] = await db
    .select({ c: competitions, maxAge: ageCategories.maxAge, catSort: ageCategories.sortOrder })
    .from(competitions)
    .leftJoin(ageCategories, eq(ageCategories.id, competitions.categoryId))
    .where(eq(competitions.id, competitionId));
  if (!comp) return [];

  const regs = await db
    .select({ r: registrations, p: players, catName: ageCategories.name, catMax: ageCategories.maxAge })
    .from(registrations)
    .innerJoin(players, eq(players.id, registrations.playerId))
    .leftJoin(ageCategories, eq(ageCategories.id, registrations.categoryId))
    .where(and(eq(registrations.clubId, clubId), eq(registrations.seasonId, comp.c.seasonId), eq(registrations.status, "APPROVED")));

  const ids = regs.map((x) => x.p.id);
  const squadList = comp.c.squadListMax != null
    ? new Set((await db.select({ pid: competitionSquads.playerId }).from(competitionSquads).where(and(eq(competitionSquads.competitionId, competitionId), eq(competitionSquads.clubId, clubId)))).map((x) => x.pid))
    : null;
  const susp = ids.length
    ? await db.select().from(suspensions).where(and(inArray(suspensions.playerId, ids), eq(suspensions.isLifted, false)))
    : [];

  return regs
    .map(({ r, p, catName, catMax }) => {
      const reasons: string[] = [];
      if (p.status === "BLOCKED") reasons.push("موقوف إداريًا");
      if (p.status === "RETIRED") reasons.push("معتزل");
      for (const s of susp.filter((s) => s.playerId === p.id && s.startDate <= on)) {
        if (s.kind === "ADMIN" && (!s.endDate || s.endDate >= on)) reasons.push(`إيقاف إداري${s.endDate ? " حتى " + s.endDate : ""}: ${s.reason}`);
        if (s.kind === "MATCHES" && (!s.competitionId || s.competitionId === competitionId) && (s.matchesTotal ?? 0) > s.matchesServed)
          reasons.push(`موقوف ${(s.matchesTotal ?? 0) - s.matchesServed} مباراة: ${s.reason}`);
      }
      if (comp.maxAge != null) {
        // عمر اللاعب بسنة الميلاد مقابل سنة بداية الموسم
        if (catMax == null || catMax > comp.maxAge) reasons.push(`خارج الفئة العمرية للمسابقة (${catName ?? "الأول"})`);
      }
      if (r.type === "LOAN" && r.loanEndDate && r.loanEndDate < on) reasons.push("انتهت مدة الإعارة");
      if (squadList && !squadList.has(p.id)) reasons.push("ليس ضمن قائمة الموسم للمسابقة");
      if (r.contractEnd && p.professionalLevel !== "AMATEUR" && r.contractEnd < on) reasons.push("انتهى العقد");
      return {
        playerId: p.id,
        registrationId: r.id,
        number: r.number,
        fullName: p.fullName,
        shirtNumber: r.shirtNumber,
        isForeign: p.isForeign,
        categoryName: catName,
        ok: reasons.length === 0,
        reasons,
      };
    })
    .sort((a, b) => (a.shirtNumber ?? 999) - (b.shirtNumber ?? 999) || a.fullName.localeCompare(b.fullName, "ar"));
}

/** حالة لاعب عبر رمز التحقق (QR) */
export async function verifyByToken(token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
  const [row] = await db.query.registrations.findMany({
    where: eq(registrations.verifyToken, token),
    with: { player: true, club: true, season: true, category: true },
    limit: 1,
  });
  return row ?? null;
}
