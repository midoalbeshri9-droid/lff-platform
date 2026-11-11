import "server-only";
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { contracts, counters, players, clubs, registrations, type ContractDoc } from "@/db/schema";
import { addCharge } from "./finance";
import { dinarsWords, tafqeet } from "./tafqeet";
import { today, UserError } from "./util";

export const CURRENCY: Record<string, string> = { LYD: "دينار ليبي", USD: "دولار أمريكي", EUR: "يورو" };
export const FEE_RATE = 0.03; // المادة (4) بند 5: 3% من إجمالي قيمة العقد لصالح الاتحاد

/** المبلغ بالحروف حسب العملة */
export function amountWords(v: string | number | null | undefined, currency = "LYD") {
  const n = Number(v);
  if (!v || !(n > 0)) return "";
  if (currency === "LYD") return `${dinarsWords(n)} ليبي`;
  return `${tafqeet(n)} ${currency === "USD" ? "دولار أمريكي" : "يورو"}`;
}

/** عدد الأشهر بين تاريخين (للتحقق من مجموع الرواتب) */
export function monthsBetween(a: string, b: string) {
  const s = new Date(a), e = new Date(b);
  return Math.max(0, (e.getFullYear() - s.getFullYear()) * 12 + e.getMonth() - s.getMonth() + (e.getDate() >= s.getDate() ? 0 : -1) + 1);
}

/** مسودة جديدة مع تعبئة ما تعرفه المنظومة عن النادي واللاعب */
export async function draftDoc(clubId: number, playerId: number): Promise<ContractDoc> {
  const [c] = await db.select().from(clubs).where(eq(clubs.id, clubId));
  const [p] = await db.select().from(players).where(eq(players.id, playerId));
  const idType = p.nationalId ? "الرقم الوطني" : p.passportNo ? "جواز سفر" : "";
  return {
    signDate: today(), signCity: c.city ?? "", signCountry: "ليبيا",
    club: { address: c.city ?? "", phone: c.phone ?? "", email: c.email ?? "", repName: "", repTitle: "رئيس النادي" },
    player: {
      nameEn: p.fullNameEn ?? "", nationality: p.nationality ?? "", birthPlace: p.placeOfBirth ?? "", birthDate: p.dateOfBirth ?? "",
      idType, idNumber: p.nationalId ?? p.passportNo ?? "", idIssuePlace: "", idIssueDate: "", idExpiry: "",
      address: p.address ?? "", phone: p.phone ?? "", email: "",
    },
    agent: null, duration: "", termType: "SEASON", endSeason: "",
  };
}

/** ما يلزم قبل الإرسال للاعتماد */
export function missingForSubmit(c: typeof contracts.$inferSelect): string[] {
  const d = c.doc, m: string[] = [];
  if (!d) return ["بيانات العقد"];
  if (!d.signCity) m.push("مدينة التوقيع");
  if (!d.club.repName) m.push("اسم ممثل النادي");
  if (!d.player.nationality) m.push("جنسية اللاعب");
  if (!d.player.birthPlace) m.push("مكان ميلاد اللاعب");
  if (!d.player.idNumber || !d.player.idType) m.push("رقم ونوع وثيقة إثبات اللاعب");
  if (!d.duration) m.push("مدة العقد");
  if (d.termType === "SEASON" && !d.endSeason) m.push("الموسم الذي ينتهي به العقد");
  if (!(Number(c.totalValue) > 0)) m.push("القيمة الإجمالية للعقد");
  if (!(Number(c.monthlySalary) > 0)) m.push("الراتب الشهري");
  if (d.agent && (!d.agent.name || !d.agent.licenseNo)) m.push("اسم الوكيل ورقم بطاقته");
  if (!c.signedFileKey) m.push("النسخة الموقّعة من العقد (صورة أو PDF)");
  return m;
}

/** اعتماد العقد: رقم العقد + مطالبة 3% على النادي + ربطه بالقيد */
export async function approve(contractId: number, by: string) {
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(contracts).where(eq(contracts.id, contractId));
    if (!c || c.status !== "SUBMITTED") throw new UserError("العقد ليس بانتظار الاعتماد");
    const year = new Date().getFullYear();
    const [row] = await tx.insert(counters).values({ key: `contract:${year}`, value: 1 })
      .onConflictDoUpdate({ target: counters.key, set: { value: sql`${counters.value} + 1` } }).returning();
    const number = `${String(row.value).padStart(4, "0")}/${year}`;
    let feeChargeId: number | null = null;
    if (c.currency === "LYD" && Number(c.totalValue) > 0) {
      const [p] = await tx.select({ name: players.fullName }).from(players).where(eq(players.id, c.playerId));
      feeChargeId = await addCharge(tx, {
        clubId: c.clubId, category: "CONTRACT_FEE", amount: (Math.round(Number(c.totalValue) * FEE_RATE * 100) / 100).toFixed(2),
        description: `رسوم اعتماد عقد محترف رقم ${number} — ${p.name} (3% من ${Number(c.totalValue).toLocaleString("en")} د.ل)`,
        refType: "contract", refId: c.id, createdBy: by,
      });
    }
    await tx.update(contracts).set({ status: "ACTIVE", number, feeChargeId, reviewedAt: new Date(), reviewedBy: by, returnNote: null, updatedAt: new Date() }).where(eq(contracts.id, c.id));
    await tx.update(registrations).set({ contractStart: c.startDate, contractEnd: c.endDate, updatedAt: new Date() }).where(eq(registrations.id, c.registrationId));
    return { number, fee: !!feeChargeId, currency: c.currency };
  });
}

/** العقود المعتمدة التي انتهت مدتها تصبح «منتهية» */
export async function expireContracts() {
  await db.update(contracts).set({ status: "EXPIRED", updatedAt: new Date() }).where(and(eq(contracts.status, "ACTIVE"), lt(contracts.endDate, today())));
}
