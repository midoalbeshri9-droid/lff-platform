import "server-only";
import { and, eq, ne, or, lte, gte, isNull, inArray, sql, desc } from "drizzle-orm";
import { db, type Tx } from "@/db";
import {
  seasons, registrationWindows, ageCategories, registrations, players, documentTypes, registrationDocuments,
  registrationEvents, counters, settings, suspensions, contracts, clubs, type RegType,
} from "@/db/schema";
import { today, UserError } from "./util";

export async function getSetting(key: string, fallback = ""): Promise<string> {
  const [r] = await db.select().from(settings).where(eq(settings.key, key));
  return r?.value ?? fallback;
}

export async function getCurrentSeason() {
  const [s] = await db.select().from(seasons).where(eq(seasons.isCurrent, true)).limit(1);
  if (s) return s;
  const [last] = await db.select().from(seasons).orderBy(desc(seasons.startDate)).limit(1);
  return last ?? null;
}

/** هل فترة القيد مفتوحة لهذا النادي اليوم؟ (فترة عامة أو استثناء خاص بالنادي) */
export async function openWindow(seasonId: number, clubId: number, on = today()) {
  const [c] = await db.select({ d: clubs.divisionId }).from(clubs).where(eq(clubs.id, clubId));
  const [w] = await db
    .select()
    .from(registrationWindows)
    .where(
      and(
        eq(registrationWindows.seasonId, seasonId),
        eq(registrationWindows.isClosed, false),
        lte(registrationWindows.startDate, on),
        gte(registrationWindows.endDate, on),
        // فترة للنادي نفسه (استثناء)، أو فترة عامة لكل الدرجات، أو فترة درجة النادي
        or(eq(registrationWindows.clubId, clubId), and(isNull(registrationWindows.clubId), or(isNull(registrationWindows.divisionId), c?.d ? eq(registrationWindows.divisionId, c.d) : undefined))),
      ),
    )
    .limit(1);
  return w ?? null;
}

/** الفئة العمرية حسب سنة الميلاد مقارنة بسنة بداية الموسم (أسلوب FIFA Connect) */
export async function categoryFor(dob: string, seasonStart: string) {
  const age = new Date(seasonStart).getFullYear() - new Date(dob).getFullYear();
  const cats = await db.select().from(ageCategories).where(eq(ageCategories.isActive, true));
  const limited = cats.filter((c) => c.maxAge != null && age <= c.maxAge!).sort((a, b) => a.maxAge! - b.maxAge!);
  return limited[0] ?? cats.find((c) => c.maxAge == null) ?? null;
}

export function isMinor(dob: string) {
  const b = new Date(dob), n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
  return a < 18;
}

/** المستندات الإلزامية لطلب معيّن */
export async function requiredDocTypes(type: RegType, p: { professionalLevel: string; dateOfBirth: string; isForeign: boolean }) {
  const all = await db.select().from(documentTypes).where(eq(documentTypes.isActive, true)).orderBy(documentTypes.sortOrder);
  return all.filter((d) => {
    if (!d.requiredFor.includes(type)) return false;
    if (d.onlyProfessional && p.professionalLevel === "AMATEUR") return false;
    if (d.onlyMinor && !isMinor(p.dateOfBirth)) return false;
    if (d.onlyForeign && !p.isForeign) return false;
    return true;
  });
}

/** المستندات الناقصة: غير مرفوعة أو كل نسخها مرفوضة */
export async function missingDocs(regId: number) {
  const [r] = await db
    .select({ type: registrations.type, p: players })
    .from(registrations)
    .innerJoin(players, eq(players.id, registrations.playerId))
    .where(eq(registrations.id, regId));
  const req = await requiredDocTypes(r.type, r.p);
  const docs = await db.select().from(registrationDocuments).where(eq(registrationDocuments.registrationId, regId));
  return req.filter((t) => !docs.some((d) => d.documentTypeId === t.id && d.status !== "REJECTED"));
}

/** لاعبون محتملون مكررون: نفس الاسم وتاريخ الميلاد */
export async function findDuplicates(fullName: string, dob: string, excludeId?: number) {
  const norm = fullName.replace(/\s+/g, " ").trim();
  return db
    .select({ id: players.id, fullName: players.fullName, nationalId: players.nationalId })
    .from(players)
    .where(
      and(
        eq(players.dateOfBirth, dob),
        sql`regexp_replace(${players.fullName}, '\\s+', ' ', 'g') = ${norm}`,
        excludeId ? ne(players.id, excludeId) : undefined,
      ),
    )
    .limit(5);
}

/** القيد الساري (المعتمد) للاعب في موسم */
export async function activeRegistration(playerId: number, seasonId: number, tx?: Tx) {
  const [r] = await (tx ?? db)
    .select()
    .from(registrations)
    .where(and(eq(registrations.playerId, playerId), eq(registrations.seasonId, seasonId), eq(registrations.status, "APPROVED")))
    .limit(1);
  return r ?? null;
}

/** آخر قيد معتمد للاعب في أي موسم */
export async function lastApproved(playerId: number) {
  const [r] = await db
    .select({ r: registrations, s: seasons })
    .from(registrations)
    .innerJoin(seasons, eq(seasons.id, registrations.seasonId))
    .where(and(eq(registrations.playerId, playerId), inArray(registrations.status, ["APPROVED", "EXPIRED", "TRANSFERRED"])))
    .orderBy(desc(seasons.startDate), desc(registrations.id))
    .limit(1);
  return r ?? null;
}

export async function nextNumber(tx: Tx | typeof db, seasonName: string) {
  const key = `reg:${seasonName}`;
  const [row] = await tx
    .insert(counters)
    .values({ key, value: 1 })
    .onConflictDoUpdate({ target: counters.key, set: { value: sql`${counters.value} + 1` } })
    .returning();
  const year = seasonName.slice(0, 4);
  return `${year}-${String(row.value).padStart(5, "0")}`;
}

export async function logEvent(tx: Tx | typeof db, registrationId: number, userName: string, action: string, note?: string | null) {
  await tx.insert(registrationEvents).values({ registrationId, userName, action, note: note ?? null });
}

/** اعتماد الطلب: رقم قيد، وإغلاق القيد السابق عند الانتقال أو الإعارة */
export async function approveRegistration(tx: Tx, regId: number, by: string, note: string | null) {
  const [r] = await tx.select().from(registrations).where(eq(registrations.id, regId));
  if (!r) throw new UserError("الطلب غير موجود");
  if (!["SUBMITTED", "NEEDS_CORRECTION"].includes(r.status)) throw new UserError("لا يمكن اعتماد طلب في هذه الحالة");
  const [s] = await tx.select().from(seasons).where(eq(seasons.id, r.seasonId));

  // قيد ساري للاعب في نفس الموسم لدى نادٍ آخر
  const existing = await activeRegistration(r.playerId, r.seasonId, tx);
  if (existing && existing.id !== r.id) {
    if (r.type === "TRANSFER" || r.type === "LOAN" || r.type === "LOAN_RETURN") {
      await tx.update(registrations)
        .set({ status: r.type === "LOAN_RETURN" ? "EXPIRED" : "TRANSFERRED", updatedAt: new Date() })
        .where(eq(registrations.id, existing.id));
      await logEvent(tx, existing.id, by, r.type === "LOAN_RETURN" ? "انتهت الإعارة بعودة اللاعب" : "أُغلق القيد بسبب انتقال/إعارة", `إلى القيد رقم ${regId}`);
      if (r.type === "TRANSFER")
        await tx.update(contracts).set({ status: "TERMINATED", terminatedAt: new Date(), terminationReason: `انتقال اللاعب (قيد رقم ${regId})`, updatedAt: new Date() })
          .where(and(eq(contracts.registrationId, existing.id), eq(contracts.status, "ACTIVE")));
    } else {
      throw new UserError("للاعب قيد ساري في هذا الموسم مع نادٍ آخر — يجب أن يكون الطلب انتقالًا أو إعارة");
    }
  }
  const number = r.number ?? (await nextNumber(tx, s.name));
  await tx.update(registrations)
    .set({ status: "APPROVED", number, decidedAt: new Date(), decidedBy: by, decisionReason: note, updatedAt: new Date() })
    .where(eq(registrations.id, regId));
  await logEvent(tx, regId, by, "اعتماد القيد", note ? `${number} — ${note}` : number);
  return number;
}

/** الإيقافات السارية للاعب في تاريخ معيّن (ولمسابقة معيّنة إن وُجدت) */
export async function activeSuspensions(playerId: number, on = today(), competitionId?: number) {
  const rows = await db.select().from(suspensions).where(and(eq(suspensions.playerId, playerId), eq(suspensions.isLifted, false)));
  return rows.filter((s) => {
    if (s.startDate > on) return false;
    if (s.kind === "ADMIN") return !s.endDate || s.endDate >= on;
    if (s.competitionId && competitionId && s.competitionId !== competitionId) return false;
    return (s.matchesTotal ?? 0) > s.matchesServed;
  });
}

/** حالة حصة الأجانب لنادٍ في موسم حسب الفئة: المستخدم / المسموح */
export async function foreignQuota(clubId: number, seasonId: number) {
  const cats = await db.select().from(ageCategories).where(eq(ageCategories.isActive, true)).orderBy(ageCategories.sortOrder);
  const used = await db.select({ cat: registrations.categoryId, n: sql<number>`count(*)::int` }).from(registrations)
    .innerJoin(players, eq(players.id, registrations.playerId))
    .where(and(eq(registrations.clubId, clubId), eq(registrations.seasonId, seasonId), eq(players.isForeign, true), inArray(registrations.status, ["APPROVED", "SUBMITTED"])))
    .groupBy(registrations.categoryId);
  return cats.map((c) => ({ id: c.id, name: c.name, max: c.maxForeign, used: used.find((u) => u.cat === c.id)?.n ?? 0 }));
}

/** يمنع تجاوز الحد المسموح للتعاقد مع الأجانب (عند الإرسال والاعتماد) */
export async function assertForeignQuota(regId: number) {
  const [r] = await db.select({ r: registrations, p: players, cat: ageCategories }).from(registrations)
    .innerJoin(players, eq(players.id, registrations.playerId)).leftJoin(ageCategories, eq(ageCategories.id, registrations.categoryId))
    .where(eq(registrations.id, regId));
  if (!r || !r.p.isForeign || !r.cat || r.cat.maxForeign == null) return;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(registrations)
    .innerJoin(players, eq(players.id, registrations.playerId))
    .where(and(eq(registrations.clubId, r.r.clubId), eq(registrations.seasonId, r.r.seasonId), eq(registrations.categoryId, r.cat.id),
      eq(players.isForeign, true), inArray(registrations.status, ["APPROVED", "SUBMITTED"]), ne(registrations.id, regId)));
  if (n >= r.cat.maxForeign) throw new UserError(`اكتمل العدد المسموح من اللاعبين الأجانب في ${r.cat.name} (${r.cat.maxForeign})`);
}

/** اللاعب المحترف أو تحت العقد يحتاج بيانات عقد */
export function needsContract(level: string) {
  return level !== "AMATEUR";
}

/** لاعبون بنفس الصورة (بصمة الملف) — لاكتشاف تسجيل نفس الشخص باسم آخر */
export async function photoDuplicates(hash: string | null, exceptPlayerId?: number) {
  if (!hash) return [];
  return db.select({ id: players.id, fullName: players.fullName }).from(players)
    .where(and(eq(players.photoHash, hash), exceptPlayerId ? ne(players.id, exceptPlayerId) : undefined)).limit(5);
}
