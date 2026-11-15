"use server";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { selfApplications, players, registrations, officials } from "@/db/schema";
import { requireClubUser, requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getCurrentSeason, categoryFor, findDuplicates, photoDuplicates, logEvent } from "@/lib/registration";
import { attempt, int, str, UserError } from "@/lib/util";

async function loadApp(id: number, kind: "PLAYER" | "OFFICIAL", clubId?: number) {
  const [a] = await db.select().from(selfApplications).where(and(eq(selfApplications.id, id), eq(selfApplications.kind, kind), clubId ? eq(selfApplications.clubId, clubId) : undefined));
  if (!a) throw new UserError("الطلب غير موجود");
  if (a.status !== "NEW") throw new UserError("تمت معالجة هذا الطلب مسبقًا");
  return a;
}

/** النادي يقبل طلب اللاعب: لاعب جديد ← سجل لاعب + طلب قيد جديد (مسودة)؛ لاعب موجود بنفس الرقم الوطني ← صفحة طلب تجديد/انتقال */
export async function acceptPlayerApp(f: FormData) {
  const u = await requireClubUser("club.edit");
  const id = int(f, "id")!;
  let go = "";
  await attempt("/club/applications", async () => {
    const a = await loadApp(id, "PLAYER", u.clubId);
    const season = await getCurrentSeason();
    if (!season) throw new UserError("لا يوجد موسم حالي — تواصل مع لجنة القيد");
    const [ex] = a.nationalId ? await db.select({ id: players.id }).from(players).where(eq(players.nationalId, a.nationalId)) : [];
    if (ex) {
      await db.update(selfApplications).set({ status: "ACCEPTED", playerId: ex.id, handledBy: u.fullName, handledAt: new Date(), reviewNote: "لاعب مسجل مسبقًا — يُكمل بطلب تجديد/انتقال" }).where(eq(selfApplications.id, id));
      go = `/club/players/new?q=${ex.id}&ok=${encodeURIComponent("اللاعب مسجل مسبقًا في المنظومة — أنشئ له طلب تجديد أو انتقال")}`;
      return;
    }
    const dups = [...(await findDuplicates(a.fullName, a.dateOfBirth)).map((d) => `#${d.id} ${d.fullName}`), ...(await photoDuplicates(a.photoHash)).map((d) => `#${d.id} ${d.fullName} (نفس الصورة)`)];
    const cat = await categoryFor(a.dateOfBirth, season.startDate);
    await db.transaction(async (tx) => {
      const [pl] = await tx.insert(players).values({
        fullName: a.fullName, fullNameEn: a.fullNameEn, motherName: a.motherName, nationalId: a.nationalId, passportNo: a.passportNo,
        dateOfBirth: a.dateOfBirth, placeOfBirth: a.placeOfBirth, gender: a.gender as "MALE", nationality: a.nationality,
        isForeign: !!a.nationality && !/ليبي/.test(a.nationality), position: (a.position ?? "UNKNOWN") as "UNKNOWN",
        phone: a.phone, address: a.address, city: a.city, photoKey: a.photoKey, photoHash: a.photoHash, createdByClubId: u.clubId,
        notes: `تسجيل ذاتي ${a.refNo}`,
      }).returning();
      const [r] = await tx.insert(registrations).values({
        playerId: pl.id, clubId: u.clubId, seasonId: season.id, type: "NEW", status: "DRAFT", categoryId: cat?.id,
        possibleDuplicates: dups.length ? dups.join("، ") : null,
      }).returning();
      await logEvent(tx, r.id, u.fullName, "إنشاء طلب قيد من تسجيل ذاتي", a.refNo);
      await tx.update(selfApplications).set({ status: "ACCEPTED", playerId: pl.id, registrationId: r.id, handledBy: u.fullName, handledAt: new Date() }).where(eq(selfApplications.id, id));
      await audit(u, "قبول تسجيل ذاتي", "Player", pl.id, { ref: a.refNo, club: u.clubName }, tx);
      go = `/club/registrations/${r.id}?ok=${encodeURIComponent("أُنشئ اللاعب وطلب القيد — ارفع المستندات ثم أرسل الطلب")}`;
    });
  }).catch((e) => { if (go) redirect(go); throw e; });
}

export async function rejectPlayerApp(f: FormData) {
  const u = await requireClubUser("club.edit");
  const id = int(f, "id")!;
  await attempt("/club/applications", async () => {
    await loadApp(id, "PLAYER", u.clubId);
    await db.update(selfApplications).set({ status: "REJECTED", reviewNote: str(f, "note"), handledBy: u.fullName, handledAt: new Date() }).where(eq(selfApplications.id, id));
    return "رُفض الطلب";
  });
}

/** لجنة الحكام تقبل طلب الحكم: يُنشأ سجل حكم بالدرجة الثالثة ثم يُستكمل من صفحته */
export async function acceptOfficialApp(f: FormData) {
  const u = await requireUser("ref.manage");
  const id = int(f, "id")!;
  let go = "";
  await attempt("/referees/applications", async () => {
    const a = await loadApp(id, "OFFICIAL");
    if (a.phone) {
      const [ex] = await db.select({ id: officials.id }).from(officials).where(eq(officials.phone, a.phone));
      if (ex) throw new UserError(`يوجد حكم مسجل بنفس رقم الهاتف (#${ex.id}) — ارفض الطلب أو حدّث السجل القائم`);
    }
    await db.transaction(async (tx) => {
      const [o] = await tx.insert(officials).values({
        fullName: a.fullName, type: (a.officialType ?? "REFEREE") as "REFEREE", grade: "THIRD", city: a.city, phone: a.phone, email: a.email,
        dateOfBirth: a.dateOfBirth, notes: [`تسجيل ذاتي ${a.refNo}`, a.experience].filter(Boolean).join(" — "),
      }).returning();
      await tx.update(selfApplications).set({ status: "ACCEPTED", officialId: o.id, handledBy: u.fullName, handledAt: new Date() }).where(eq(selfApplications.id, id));
      await audit(u, "قبول تسجيل ذاتي (حكم)", "Official", o.id, { ref: a.refNo }, tx);
      go = `/referees/${o.id}?ok=${encodeURIComponent("أُضيف الحكم — أكمل بياناته ورخصته")}`;
    });
  }).catch((e) => { if (go) redirect(go); throw e; });
}

export async function rejectOfficialApp(f: FormData) {
  const u = await requireUser("ref.manage");
  const id = int(f, "id")!;
  await attempt("/referees/applications", async () => {
    await loadApp(id, "OFFICIAL");
    await db.update(selfApplications).set({ status: "REJECTED", reviewNote: str(f, "note"), handledBy: u.fullName, handledAt: new Date() }).where(eq(selfApplications.id, id));
    return "رُفض الطلب";
  });
}
