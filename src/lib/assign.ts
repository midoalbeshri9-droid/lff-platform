import "server-only";
import { and, eq, ne, desc, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { officials, assignments, matches, clubs } from "@/db/schema";
import { ROLE_FITS, ASSIGN_ROLE, OFFICIAL_TYPE } from "./labels";

/** فحص تعارضات التعيين: يُرجع أخطاء مانعة وتحذيرات */
export async function checkAssignment(matchId: number, officialId: number, role: string) {
  const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
  const [o] = await db.select().from(officials).where(eq(officials.id, officialId));
  const errors: string[] = [], warnings: string[] = [];
  if (!m || !o) return { errors: ["بيانات غير صحيحة"], warnings };
  const day = (m.kickoff ?? new Date()).toISOString().slice(0, 10);
  if (!ROLE_FITS[role]?.includes(o.type)) errors.push(`${OFFICIAL_TYPE[o.type]} لا يصلح لدور ${ASSIGN_ROLE[role]}`);
  if (o.status !== "ACTIVE") {
    if (!(o.status === "SUSPENDED" && o.suspendedUntil && o.suspendedUntil < day)) errors.push(`الحالة: ${o.status === "SUSPENDED" ? "موقوف" : o.status === "INJURED" ? "مصاب" : "معتزل"}`);
  }
  if (["REFEREE", "ASSISTANT", "VAR"].includes(o.type) && o.fitness === "FAILED") errors.push("راسب في اختبار اللياقة");
  if (o.licenseExpiry && o.licenseExpiry < day) errors.push("الرخصة منتهية");
  // نفس اليوم
  const sameDay = await db.select({ a: assignments, k: matches.kickoff }).from(assignments).innerJoin(matches, eq(matches.id, assignments.matchId))
    .where(and(eq(assignments.officialId, officialId), ne(assignments.matchId, matchId), ne(assignments.status, "DECLINED")));
  if (sameDay.some((x) => x.k && x.k.toISOString().slice(0, 10) === day)) errors.push("معيّن في مباراة أخرى في نفس اليوم");
  const inMatch = await db.select().from(assignments).where(and(eq(assignments.matchId, matchId), eq(assignments.officialId, officialId), ne(assignments.role, role as "REFEREE")));
  if (inMatch.length) errors.push("معيّن في دور آخر في نفس المباراة");
  // نفس مدينة أحد الفريقين
  const cls = await db.select().from(clubs).where(inArray(clubs.id, [m.homeClubId, m.awayClubId]));
  if (o.city && cls.some((c) => c.city && c.city.trim() === o.city!.trim())) warnings.push(`من نفس مدينة أحد الفريقين (${o.city})`);
  // أدار مباريات الفريقين مؤخرًا
  const recent = await db.select({ id: matches.id }).from(assignments).innerJoin(matches, eq(matches.id, assignments.matchId))
    .where(and(eq(assignments.officialId, officialId), eq(assignments.role, "REFEREE"), ne(matches.id, matchId),
      or(inArray(matches.homeClubId, [m.homeClubId, m.awayClubId]), inArray(matches.awayClubId, [m.homeClubId, m.awayClubId]))))
    .orderBy(desc(matches.kickoff)).limit(5);
  if (role === "REFEREE" && recent.length >= 2) warnings.push(`أدار ${recent.length} مباريات لأحد الفريقين مؤخرًا`);
  return { errors, warnings };
}

