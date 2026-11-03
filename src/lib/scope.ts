import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { and, eq, inArray, isNull, or, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { clubs, competitions, officials, matches, registrations, players, competitionStages, sanctions, staff, divisions } from "@/db/schema";
import type { CurrentUser } from "./auth";
import { UserError } from "./util";

/**
 * حصر الصلاحيات بالدرجة:
 * مدير/موظف الدرجة لا يرى ولا يدير إلا أندية درجته ومسابقاتها ومبارياتها ولاعبيها وحكامها.
 * مستخدمو الاتحاد (بلا درجة) يرون كل شيء كما هو.
 */
export type Scope = { divisionId: number; divisionName: string; clubIds: number[]; compIds: number[]; officialIds: number[] };

export const scopeOf = cache(async (u: CurrentUser | null): Promise<Scope | null> => {
  if (!u?.divisionId) return null;
  const d = u.divisionId;
  const [div] = await db.select({ name: divisions.name }).from(divisions).where(eq(divisions.id, d));
  const cl = await db.select({ id: clubs.id }).from(clubs).where(eq(clubs.divisionId, d));
  const cs = await db.select({ id: competitions.id }).from(competitions).where(eq(competitions.divisionId, d));
  const os = await db.select({ id: officials.id }).from(officials).where(or(eq(officials.divisionId, d), isNull(officials.divisionId)));
  return { divisionId: d, divisionName: div?.name ?? "", clubIds: cl.map((x) => x.id), compIds: cs.map((x) => x.id), officialIds: os.map((x) => x.id) };
});

const ids = (a: number[]) => (a.length ? a : [-1]);
/** شروط التصفية في الاستعلامات (undefined = بلا تصفية لمستخدمي الاتحاد) */
export const clubIn = (s: Scope | null, col: AnyPgColumn): SQL | undefined => (s ? inArray(col, ids(s.clubIds)) : undefined);
export const compIn = (s: Scope | null, col: AnyPgColumn): SQL | undefined => (s ? inArray(col, ids(s.compIds)) : undefined);
export const officialIn = (s: Scope | null, col: AnyPgColumn): SQL | undefined => (s ? inArray(col, ids(s.officialIds)) : undefined);
/** طلب قيد يخص الدرجة: النادي الطالب أو النادي السابق من أنديتها */
export const regIn = (s: Scope | null): SQL | undefined => (s ? or(inArray(registrations.clubId, ids(s.clubIds)), inArray(registrations.fromClubId, ids(s.clubIds))) : undefined);

// ---------------- فحوص الوصول ----------------
export async function inScopeClub(u: CurrentUser, clubId: number | null | undefined) {
  const s = await scopeOf(u);
  return !s || (!!clubId && s.clubIds.includes(clubId));
}
export async function inScopeComp(u: CurrentUser, compId: number | null | undefined) {
  const s = await scopeOf(u);
  return !s || (!!compId && s.compIds.includes(compId));
}
export async function inScopeMatch(u: CurrentUser, matchId: number | null | undefined) {
  const s = await scopeOf(u);
  if (!s) return true;
  if (!matchId) return false;
  const [m] = await db.select({ c: matches.competitionId }).from(matches).where(eq(matches.id, matchId));
  return !!m && s.compIds.includes(m.c);
}
export async function inScopeStage(u: CurrentUser, stageId: number | null | undefined) {
  const s = await scopeOf(u);
  if (!s) return true;
  if (!stageId) return false;
  const [st] = await db.select({ c: competitionStages.competitionId }).from(competitionStages).where(eq(competitionStages.id, stageId));
  return !!st && s.compIds.includes(st.c);
}
export async function inScopeReg(u: CurrentUser, regId: number | null | undefined) {
  const s = await scopeOf(u);
  if (!s) return true;
  if (!regId) return false;
  const [r] = await db.select({ c: registrations.clubId, f: registrations.fromClubId }).from(registrations).where(eq(registrations.id, regId));
  return !!r && (s.clubIds.includes(r.c) || (!!r.f && s.clubIds.includes(r.f)));
}
export async function inScopePlayer(u: CurrentUser, playerId: number | null | undefined) {
  const s = await scopeOf(u);
  if (!s) return true;
  if (!playerId) return false;
  const [r] = await db.select({ id: registrations.id }).from(registrations).where(and(eq(registrations.playerId, playerId), regIn(s))).limit(1);
  if (r) return true;
  const [p] = await db.select({ c: players.createdByClubId }).from(players).where(eq(players.id, playerId));
  return !!p?.c && s.clubIds.includes(p.c);
}
/** الحكم: الاطلاع والتعيين لحكام الدرجة والقائمة الاتحادية، والتعديل لحكام الدرجة فقط */
export async function inScopeOfficial(u: CurrentUser, officialId: number | null | undefined, edit = false) {
  const s = await scopeOf(u);
  if (!s) return true;
  if (!officialId) return false;
  const [o] = await db.select({ d: officials.divisionId }).from(officials).where(eq(officials.id, officialId));
  if (!o) return false;
  return edit ? o.d === s.divisionId : o.d === s.divisionId || o.d == null;
}
export async function inScopeSanction(u: CurrentUser, id: number | null | undefined) {
  const s = await scopeOf(u);
  if (!s) return true;
  if (!id) return false;
  const [x] = await db.select({ c: sanctions.clubId }).from(sanctions).where(eq(sanctions.id, id));
  return !!x && s.clubIds.includes(x.c);
}
export async function inScopeStaff(u: CurrentUser, id: number | null | undefined) {
  const s = await scopeOf(u);
  if (!s) return true;
  if (!id) return false;
  const [x] = await db.select({ c: staff.clubId }).from(staff).where(eq(staff.id, id));
  return !!x && s.clubIds.includes(x.c);
}

/** في الصفحات: تحويل إلى «غير مصرح» */
export function guardPage(ok: boolean) {
  if (!ok) redirect("/denied");
}
/** في الإجراءات: رسالة خطأ واضحة */
export function guard(ok: boolean) {
  if (!ok) throw new UserError("هذا العنصر خارج نطاق درجتك — لا تملك صلاحية عليه");
}
