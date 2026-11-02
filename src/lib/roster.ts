import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { registrations, players, clubs, seasons, ageCategories } from "@/db/schema";
import { alias } from "drizzle-orm/pg-core";
import { POSITION, PRO_LEVEL, REG_TYPE } from "./labels";
import { fmtDate } from "./util";

type Row = Awaited<ReturnType<typeof loadRoster>>["rows"][number];

// الأعمدة المتاحة في قوائم الفرق — يختار منها المستخدم ما يريد
export const ROSTER_COLUMNS: { key: string; label: string; get: (x: Row, i: number) => string }[] = [
  { key: "seq", label: "م", get: (_x, i) => String(i + 1) },
  { key: "photo", label: "الصورة", get: () => "" },
  { key: "number", label: "رقم القيد", get: (x) => x.r.number ?? "" },
  { key: "fullName", label: "الاسم", get: (x) => x.p.fullName },
  { key: "fullNameEn", label: "الاسم بالإنجليزية", get: (x) => x.p.fullNameEn ?? "" },
  { key: "dob", label: "تاريخ الميلاد", get: (x) => fmtDate(x.p.dateOfBirth) },
  { key: "birthYear", label: "سنة الميلاد", get: (x) => x.p.dateOfBirth.slice(0, 4) },
  { key: "placeOfBirth", label: "مكان الميلاد", get: (x) => x.p.placeOfBirth ?? "" },
  { key: "nationalId", label: "الرقم الوطني", get: (x) => x.p.nationalId ?? "" },
  { key: "passportNo", label: "رقم الجواز", get: (x) => x.p.passportNo ?? "" },
  { key: "nationality", label: "الجنسية", get: (x) => x.p.nationality },
  { key: "foreign", label: "أجنبي", get: (x) => (x.p.isForeign ? "نعم" : "") },
  { key: "category", label: "الفئة", get: (x) => x.cat ?? "" },
  { key: "position", label: "المركز", get: (x) => POSITION[x.p.position] },
  { key: "shirt", label: "رقم القميص", get: (x) => (x.r.shirtNumber ? String(x.r.shirtNumber) : "") },
  { key: "level", label: "الصفة", get: (x) => PRO_LEVEL[x.p.professionalLevel] },
  { key: "regType", label: "نوع القيد", get: (x) => REG_TYPE[x.r.type] },
  { key: "fromClub", label: "النادي السابق", get: (x) => x.fromClub ?? "" },
  { key: "contractEnd", label: "نهاية العقد", get: (x) => (x.r.contractEnd ? fmtDate(x.r.contractEnd) : "") },
  { key: "approvedAt", label: "تاريخ الاعتماد", get: (x) => (x.r.decidedAt ? fmtDate(x.r.decidedAt) : "") },
  { key: "phone", label: "الهاتف", get: (x) => x.p.phone ?? "" },
  { key: "signature", label: "توقيع اللاعب", get: () => "" },
];
export const DEFAULT_COLUMNS = ["seq", "photo", "number", "fullName", "dob", "nationalId", "category", "position", "shirt"];

export async function loadRoster(seasonId: number, clubIds: number[], categoryId?: number | null) {
  const fc = alias(clubs, "fc");
  const rows = await db
    .select({ r: registrations, p: players, club: clubs, cat: ageCategories.name, catSort: ageCategories.sortOrder, fromClub: fc.name })
    .from(registrations)
    .innerJoin(players, eq(players.id, registrations.playerId))
    .innerJoin(clubs, eq(clubs.id, registrations.clubId))
    .leftJoin(ageCategories, eq(ageCategories.id, registrations.categoryId))
    .leftJoin(fc, eq(fc.id, registrations.fromClubId))
    .where(and(
      eq(registrations.seasonId, seasonId), eq(registrations.status, "APPROVED"),
      clubIds.length ? inArray(registrations.clubId, clubIds) : undefined,
      categoryId ? eq(registrations.categoryId, categoryId) : undefined,
    ));
  rows.sort((a, b) => a.club.name.localeCompare(b.club.name, "ar") || (a.catSort ?? 0) - (b.catSort ?? 0) || (a.r.shirtNumber ?? 999) - (b.r.shirtNumber ?? 999) || a.p.fullName.localeCompare(b.p.fullName, "ar"));
  const [season] = await db.select().from(seasons).where(eq(seasons.id, seasonId));
  const byClub = new Map<number, { club: (typeof rows)[number]["club"]; rows: typeof rows }>();
  for (const r of rows) {
    if (!byClub.has(r.club.id)) byClub.set(r.club.id, { club: r.club, rows: [] });
    byClub.get(r.club.id)!.rows.push(r);
  }
  return { season, rows, groups: [...byClub.values()] };
}
