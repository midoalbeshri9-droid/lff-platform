import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { registrations, seasons, clubs, players, passportRecords } from "@/db/schema";

export type PassportRow = { club: string; country: string; level: string | null; loan: boolean; from: string; to: string | null; manual: boolean; manualId?: number };

/** جواز اللاعب كما في FIFA Connect: الأندية التي سُجّل لها لاعبًا منذ عيد ميلاده الثاني عشر،
 *  والمواسم المتتالية بنفس النادي والمستوى ونوع القيد (دائم/إعارة) تُدمج في سجل واحد */
export async function playerPassport(playerId: number): Promise<{ dob: string | null; from12: string | null; rows: PassportRow[] }> {
  const [p] = await db.select({ dob: players.dateOfBirth, level: players.professionalLevel }).from(players).where(eq(players.id, playerId));
  const from12 = p?.dob ? `${Number(p.dob.slice(0, 4)) + 12}${p.dob.slice(4)}` : null;
  const regs = await db.select({ club: clubs.name, clubId: registrations.clubId, type: registrations.type, level: registrations.level, status: registrations.status, start: seasons.startDate, end: seasons.endDate, isCurrent: seasons.isCurrent })
    .from(registrations).innerJoin(clubs, eq(clubs.id, registrations.clubId)).innerJoin(seasons, eq(seasons.id, registrations.seasonId))
    .where(and(eq(registrations.playerId, playerId), inArray(registrations.status, ["APPROVED", "TRANSFERRED", "EXPIRED"])))
    .orderBy(asc(seasons.startDate), asc(registrations.id));
  const auto: PassportRow[] = [];
  for (const r of regs) {
    if (from12 && r.end < from12) continue; // قبل سن 12
    const from = from12 && r.start < from12 ? from12 : r.start;
    const loan = r.type === "LOAN";
    const level = r.level ?? (r.isCurrent ? p?.level ?? null : null);
    const last = auto[auto.length - 1];
    if (last && last.club === r.club && last.loan === loan && (last.level ?? "") === (level ?? "")) { last.to = r.end; continue; }
    if (last && (!last.to || last.to > from)) last.to = from;
    auto.push({ club: r.club, country: "ليبيا", level, loan, from, to: r.end, manual: false });
  }
  // السجل الحالي بلا تاريخ نهاية (ما زال مسجّلًا)
  const cur = regs[regs.length - 1];
  if (cur && cur.isCurrent && cur.status === "APPROVED" && auto.length) auto[auto.length - 1].to = null;
  const manual = (await db.select().from(passportRecords).where(eq(passportRecords.playerId, playerId)).orderBy(asc(passportRecords.startDate)))
    .map((m): PassportRow => ({ club: m.clubName, country: m.country, level: m.level, loan: m.isLoan, from: m.startDate, to: m.endDate, manual: true, manualId: m.id }));
  const rows = [...manual, ...auto].sort((a, b) => a.from.localeCompare(b.from));
  return { dob: p?.dob ?? null, from12, rows };
}
