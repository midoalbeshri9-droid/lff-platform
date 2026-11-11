"use server";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { contracts, registrations, players, type ContractDoc } from "@/db/schema";
import { requireClubUser } from "@/lib/auth";
import { attempt, str, int, num, UserError } from "@/lib/util";
import { audit, notifyStaff } from "@/lib/audit";
import { saveUpload, ALLOWED_DOC } from "@/lib/storage";
import { draftDoc, missingForSubmit } from "@/lib/contracts";

const editable = (s: string) => s === "DRAFT" || s === "RETURNED";

async function own(id: number, clubId: number) {
  const [c] = await db.select().from(contracts).where(and(eq(contracts.id, id), eq(contracts.clubId, clubId)));
  if (!c) throw new UserError("العقد غير موجود");
  return c;
}

/** إنشاء مسودة عقد لقيد لاعب من لاعبي النادي */
export async function createContract(f: FormData) {
  const u = await requireClubUser("club.edit");
  const regId = int(f, "regId")!;
  let id = 0;
  await attempt(() => (id ? `/club/contracts/${id}` : "/club/contracts"), async () => {
    const [r] = await db.select().from(registrations).where(and(eq(registrations.id, regId), eq(registrations.clubId, u.clubId)));
    if (!r) throw new UserError("القيد غير موجود");
    if (["REJECTED", "CANCELLED"].includes(r.status)) throw new UserError("لا يمكن إنشاء عقد لقيد مرفوض أو ملغى");
    const [ex] = await db.select({ id: contracts.id }).from(contracts).where(eq(contracts.registrationId, regId));
    if (ex) { id = ex.id; return "للاعب عقد على هذا القيد — فُتح العقد"; }
    const doc = await draftDoc(u.clubId, r.playerId);
    // ممثل النادي وعنوانه من آخر عقد كتبه النادي
    const [last] = await db.select({ doc: contracts.doc }).from(contracts).where(and(eq(contracts.clubId, u.clubId), isNotNull(contracts.doc))).orderBy(desc(contracts.id)).limit(1);
    if (last?.doc) doc.club = { ...last.doc.club };
    const start = new Date().toISOString().slice(0, 10);
    const end = new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10);
    const [n] = await db.insert(contracts).values({ registrationId: regId, playerId: r.playerId, clubId: u.clubId, startDate: start, endDate: end, status: "DRAFT", doc }).returning();
    id = n.id;
    await audit(u, "إنشاء مسودة عقد محترف", "Contract", n.id);
    return "أُنشئت مسودة العقد — أكمل بياناته";
  });
}

const t = (f: FormData, k: string) => str(f, k) ?? "";

/** حفظ بيانات العقد (المسودة أو المعاد للاستكمال) */
export async function saveContractDoc(f: FormData) {
  const u = await requireClubUser("club.edit");
  const id = int(f, "id")!;
  await attempt(`/club/contracts/${id}`, async () => {
    const c = await own(id, u.clubId);
    if (!editable(c.status)) throw new UserError("لا يمكن تعديل العقد بعد إرساله للاعتماد");
    const startDate = t(f, "startDate"), endDate = t(f, "endDate");
    if (!startDate || !endDate) throw new UserError("أدخل تاريخ بداية ونهاية العقد");
    if (endDate <= startDate) throw new UserError("نهاية العقد يجب أن تكون بعد بدايته");
    const hasAgent = f.get("hasAgent") === "on";
    const doc: ContractDoc = {
      signDate: t(f, "signDate"), signCity: t(f, "signCity"), signCountry: t(f, "signCountry") || "ليبيا",
      club: { address: t(f, "clubAddress"), phone: t(f, "clubPhone"), email: t(f, "clubEmail"), repName: t(f, "repName"), repTitle: t(f, "repTitle") || "رئيس النادي" },
      player: {
        nameEn: t(f, "nameEn"), nationality: t(f, "nationality"), birthPlace: t(f, "birthPlace"), birthDate: t(f, "birthDate"),
        idType: t(f, "idType"), idNumber: t(f, "idNumber"), idIssuePlace: t(f, "idIssuePlace"), idIssueDate: t(f, "idIssueDate"), idExpiry: t(f, "idExpiry"),
        address: t(f, "pAddress"), phone: t(f, "pPhone"), email: t(f, "pEmail"),
      },
      agent: hasAgent ? {
        name: t(f, "aName"), nationality: t(f, "aNationality"), passportNo: t(f, "aPassport"), passportPlace: t(f, "aPassportPlace"),
        passportIssue: t(f, "aPassportIssue"), passportExpiry: t(f, "aPassportExpiry"), licenseNo: t(f, "aLicense"), licenseIssuer: t(f, "aLicenseIssuer"), licenseExpiry: t(f, "aLicenseExpiry"),
      } : null,
      duration: t(f, "duration"), termType: f.get("termType") === "DATE" ? "DATE" : "SEASON", endSeason: t(f, "endSeason"),
    };
    await db.update(contracts).set({
      startDate, endDate, currency: ["LYD", "USD", "EUR"].includes(t(f, "currency")) ? t(f, "currency") : "LYD",
      totalValue: num(f, "totalValue"), signingBonus: num(f, "signingBonus"), monthlySalary: num(f, "monthlySalary"),
      housingAmount: num(f, "housingAmount"), transportAmount: num(f, "transportAmount"),
      housing: Number(num(f, "housingAmount") ?? 0) > 0, transport: Number(num(f, "transportAmount") ?? 0) > 0,
      otherBenefits: str(f, "otherBenefits"), doc, updatedAt: new Date(),
    }).where(eq(contracts.id, id));
    return "تم حفظ العقد";
  });
}

/** رفع نسخة العقد الموقّعة من الطرفين (مع البصمة والختم) */
export async function uploadSignedContract(f: FormData) {
  const u = await requireClubUser("club.edit");
  const id = int(f, "id")!;
  await attempt(`/club/contracts/${id}`, async () => {
    const c = await own(id, u.clubId);
    if (!editable(c.status)) throw new UserError("لا يمكن تغيير النسخة الموقّعة بعد الإرسال");
    const s = await saveUpload(f.get("file") as File, `docs/${u.clubId}/contracts`, ALLOWED_DOC, 15 * 1024 * 1024);
    await db.update(contracts).set({ signedFileKey: s.key, updatedAt: new Date() }).where(eq(contracts.id, id));
    return "تم رفع النسخة الموقّعة";
  });
}

/** إرسال العقد إلى لجنة أوضاع اللاعبين وانتقالاتهم للاعتماد */
export async function submitContract(f: FormData) {
  const u = await requireClubUser("club.submit");
  const id = int(f, "id")!;
  await attempt(`/club/contracts/${id}`, async () => {
    const c = await own(id, u.clubId);
    if (!editable(c.status)) throw new UserError("العقد مُرسل مسبقًا");
    const miss = missingForSubmit(c);
    if (miss.length) throw new UserError("بيانات ناقصة: " + miss.join("، "));
    await db.update(contracts).set({ status: "SUBMITTED", submittedAt: new Date(), updatedAt: new Date() }).where(eq(contracts.id, id));
    const [p] = await db.select({ name: players.fullName }).from(players).where(eq(players.id, c.playerId));
    await notifyStaff(["REG_HEAD", "REG_STAFF"], `عقد محترف بانتظار الاعتماد — ${u.clubName}`, p.name, `/registration/contracts/${id}`, { clubId: u.clubId });
    await audit(u, "إرسال عقد للاعتماد", "Contract", id);
    return "أُرسل العقد إلى لجنة أوضاع اللاعبين وانتقالاتهم";
  });
}
