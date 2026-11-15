import "server-only";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { registrations, players } from "@/db/schema";
import { getSetting } from "./registration";
import { UserError } from "./util";

/** الرقم الوطني الليبي: الخانة الأولى للجنس (1 ذكر، 2 أنثى) ثم أربع خانات لسنة الميلاد.
 *  يعيد سبب عدم التطابق أو null */
export function nidMismatch(nid: string | null | undefined, dob: string | null | undefined, gender?: string | null) {
  if (!nid || !/^\d{12}$/.test(nid)) return null;
  const out: string[] = [];
  const g = nid[0] === "1" ? "MALE" : nid[0] === "2" ? "FEMALE" : null;
  if (!g) out.push("الخانة الأولى يجب أن تكون 1 (ذكر) أو 2 (أنثى)");
  else if (gender && g !== gender) out.push(`الخانة الأولى (${nid[0]}) تدل على ${g === "MALE" ? "ذكر" : "أنثى"} بينما الجنس المُدخل ${gender === "MALE" ? "ذكر" : "أنثى"}`);
  if (dob && nid.slice(1, 5) !== dob.slice(0, 4)) out.push(`سنة الميلاد في الرقم (${nid.slice(1, 5)}) لا تطابق تاريخ الميلاد (${dob.slice(0, 4)})`);
  return out.length ? "الرقم الوطني لا يطابق البيانات: " + out.join("؛ ") : null;
}

/** وضع التحقق: BLOCK يرفض الحفظ، WARN يحفظ مع تنبيه للمراجع */
export async function nidMode() {
  return (await getSetting("nid_check", "WARN")) === "BLOCK" ? "BLOCK" : "WARN";
}

/** يتحقق من الرقم الوطني: يرمي خطأ في وضع المنع، ويعيد نص التنبيه في وضع التنبيه */
export async function checkNid(nid: string | null | undefined, dob: string | null | undefined, gender?: string | null) {
  const m = nidMismatch(nid, dob, gender);
  if (!m) return null;
  if ((await nidMode()) === "BLOCK") throw new UserError(m);
  return `⚠ ${m}`;
}

const LIVE = ["DRAFT", "SUBMITTED", "NEEDS_CORRECTION", "APPROVED"] as const;

/** أول رقم غلالة شاغر في النادي (نفس الموسم والفئة) */
export async function freeShirt(clubId: number, seasonId: number, categoryId: number | null, exceptRegId?: number) {
  const used = await db.select({ s: registrations.shirtNumber }).from(registrations)
    .where(and(eq(registrations.clubId, clubId), eq(registrations.seasonId, seasonId), inArray(registrations.status, [...LIVE]),
      categoryId ? eq(registrations.categoryId, categoryId) : undefined, exceptRegId ? ne(registrations.id, exceptRegId) : undefined));
  const set = new Set(used.map((u) => u.s).filter((x): x is number => x != null));
  for (let n = 1; n <= 99; n++) if (!set.has(n)) return n;
  return null;
}

/** رقم الغلالة لا يتكرر بين لاعبي النادي في الموسم والفئة نفسيهما (المسودات والمرسلة والمعتمدة) */
export async function assertShirtFree(o: { clubId: number; seasonId: number; categoryId: number | null; shirt: number | null; exceptRegId?: number }) {
  if (o.shirt == null) return;
  if (!(o.shirt >= 1 && o.shirt <= 99)) throw new UserError("رقم الغلالة من 1 إلى 99");
  const [dup] = await db.select({ name: players.fullName }).from(registrations).innerJoin(players, eq(players.id, registrations.playerId))
    .where(and(eq(registrations.clubId, o.clubId), eq(registrations.seasonId, o.seasonId), inArray(registrations.status, [...LIVE]), eq(registrations.shirtNumber, o.shirt),
      o.categoryId ? eq(registrations.categoryId, o.categoryId) : undefined, o.exceptRegId ? ne(registrations.id, o.exceptRegId) : undefined));
  if (dup) {
    const f = await freeShirt(o.clubId, o.seasonId, o.categoryId, o.exceptRegId);
    throw new UserError(`رقم الغلالة (${o.shirt}) مستخدم للاعب ${dup.name} في النادي نفسه${f ? ` — أول رقم شاغر: ${f}` : ""}`);
  }
}

/** صلاحية الكشف الطبي */
export async function medicalMonths() {
  const n = Number(await getSetting("medical_valid_months", "12"));
  return n > 0 ? n : 12;
}
export function medicalExpiry(examDate: string | null | undefined, months: number) {
  if (!examDate) return null;
  const d = new Date(examDate + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}
