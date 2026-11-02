import "server-only";
import { and, eq, inArray, sql, isNull, or, gte } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { charges, feeTypes, counters, refereeRates, assignments, officials, settings, sanctions, matches, clubs } from "@/db/schema";
import { today, UserError } from "./util";

type Q = Tx | typeof db;

/** تسجيل مستحق (مرة واحدة لكل مرجع) */
export async function addCharge(q: Q, c: {
  direction?: "IN" | "OUT"; clubId?: number | null; officialId?: number | null; category: string; description: string;
  amount: string | number; refType?: string; refId?: number; dueDate?: string | null; createdBy: string;
}) {
  const amt = Number(c.amount);
  if (!(amt > 0)) return null;
  if (c.refType && c.refId) {
    const [ex] = await q.select({ id: charges.id }).from(charges)
      .where(and(eq(charges.refType, c.refType), eq(charges.refId, c.refId), c.officialId ? eq(charges.officialId, c.officialId) : isNull(charges.officialId)));
    if (ex) return ex.id;
  }
  const [row] = await q.insert(charges).values({
    direction: c.direction ?? "IN", clubId: c.clubId ?? null, officialId: c.officialId ?? null, category: c.category, description: c.description,
    amount: amt.toFixed(2), refType: c.refType ?? null, refId: c.refId ?? null, dueDate: c.dueDate ?? null, createdBy: c.createdBy,
  }).returning();
  return row.id;
}

/** إلغاء مستحق مرتبط بمرجع (مثلًا عند إلغاء عقوبة) إن لم يُدفع منه شيء */
export async function cancelChargeByRef(q: Q, refType: string, refId: number) {
  const rows = await q.select().from(charges).where(and(eq(charges.refType, refType), eq(charges.refId, refId)));
  for (const r of rows) {
    if (Number(r.paidAmount) > 0) continue;
    await q.update(charges).set({ status: "CANCELLED" }).where(eq(charges.id, r.id));
  }
}

export async function feeAmount(code: string, professional = false) {
  const [f] = await db.select().from(feeTypes).where(and(eq(feeTypes.code, code), eq(feeTypes.isActive, true)));
  if (!f) return 0;
  return Number(professional && f.amountPro != null ? f.amountPro : f.amount);
}

export async function nextReceiptNo(q: Q, prefix = "R") {
  const key = `rcpt:${prefix}:${new Date().getFullYear()}`;
  const [row] = await q.insert(counters).values({ key, value: 1 })
    .onConflictDoUpdate({ target: counters.key, set: { value: sql`${counters.value} + 1` } }).returning();
  return `${prefix}${new Date().getFullYear()}-${String(row.value).padStart(5, "0")}`;
}

/** رصيد نادٍ: إجمالي المستحق، المدفوع، المتبقي، والمتأخر */
export async function clubBalance(clubId: number) {
  const s = await getSettings();
  const days = Number(s.overdue_days ?? 30);
  const cutoff = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const [r] = await db.select({
    total: sql<string>`coalesce(sum(${charges.amount}), 0)`,
    paid: sql<string>`coalesce(sum(${charges.paidAmount}), 0)`,
    overdue: sql<string>`coalesce(sum(case when coalesce(${charges.dueDate}, ${charges.createdAt}::date) < ${cutoff} then ${charges.amount} - ${charges.paidAmount} else 0 end), 0)`,
  }).from(charges).where(and(eq(charges.clubId, clubId), eq(charges.direction, "IN"), inArray(charges.status, ["OPEN", "PARTIAL", "PAID"])));
  const total = Number(r.total), paid = Number(r.paid);
  return { total, paid, outstanding: Math.max(0, total - paid), overdue: Math.max(0, Number(r.overdue)) };
}

export async function getSettings(): Promise<Record<string, string>> {
  return Object.fromEntries((await db.select().from(settings)).map((x) => [x.key, x.value]));
}

/** هل النادي ممنوع من إرسال طلبات القيد؟ (عقوبة منع تسجيل سارية، أو مستحقات متأخرة إن فُعّلت القاعدة) */
export async function clubBlockReason(clubId: number): Promise<string | null> {
  const t = today();
  const [ban] = await db.select().from(sanctions).where(and(
    eq(sanctions.clubId, clubId), eq(sanctions.targetType, "CLUB"), eq(sanctions.type, "REGISTRATION_BAN"), eq(sanctions.status, "ACTIVE"),
    or(isNull(sanctions.fromDate), sql`${sanctions.fromDate} <= ${t}`), or(isNull(sanctions.toDate), gte(sanctions.toDate, t)),
  )).limit(1);
  if (ban) return `النادي ممنوع من التسجيل والانتقالات بقرار رقم ${ban.number}${ban.toDate ? " حتى " + ban.toDate : ""}`;
  const s = await getSettings();
  if (s.block_overdue === "1") {
    const b = await clubBalance(clubId);
    if (b.overdue > Number(s.block_overdue_min ?? 0)) return `على النادي مستحقات متأخرة (${b.overdue.toFixed(2)} د.ل) — يجب سدادها لدى اللجنة المالية قبل إرسال الطلبات`;
  }
  return null;
}

/** مستحقات طاقم التحكيم عن مباراة اعتُمد تقريرها */
export async function refereeFeesForMatch(q: Q, matchId: number, by: string) {
  const rows = await q.select({ a: assignments, grade: officials.grade, name: officials.fullName }).from(assignments)
    .innerJoin(officials, eq(officials.id, assignments.officialId))
    .where(and(eq(assignments.matchId, matchId), eq(assignments.status, "APPROVED")));
  if (!rows.length) return { n: 0, total: 0 };
  const rates = await q.select().from(refereeRates);
  const [m] = await q.select().from(matches).where(eq(matches.id, matchId));
  const cl = await q.select({ id: clubs.id, name: clubs.name }).from(clubs).where(inArray(clubs.id, [m.homeClubId, m.awayClubId]));
  const title = `${cl.find((c) => c.id === m.homeClubId)?.name} × ${cl.find((c) => c.id === m.awayClubId)?.name}`;
  let n = 0, total = 0;
  for (const r of rows) {
    const role = r.a.role === "REF_OBSERVER" ? "COMMISSIONER" : r.a.role;
    const rate = rates.find((x) => x.role === role && x.grade === r.grade) ?? rates.find((x) => x.role === role && x.grade == null);
    const amount = r.a.fee ?? rate?.amount;
    if (!amount || Number(amount) <= 0) continue;
    total += Number(amount);
    const id = await addCharge(q, { direction: "OUT", officialId: r.a.officialId, category: "REFEREE_FEE", description: `${title} — الجولة ${m.round}`, amount, refType: "match", refId: matchId, createdBy: by });
    if (id) n++;
  }
  return { n, total, title };
}

export function assertPositive(v: number, msg = "المبلغ يجب أن يكون أكبر من صفر") {
  if (!(v > 0)) throw new UserError(msg);
}
