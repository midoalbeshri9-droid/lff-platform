"use server";
import { and, eq, inArray, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  registrations, registrationDocuments, players, suspensions, seasons, registrationWindows, ageCategories, documentTypes,
  listTemplates, cardTemplates, cardPrints, settings, staff, type CardElement,
} from "@/db/schema";
import { guard, scopeOf, inScopeReg, inScopePlayer, inScopeComp, inScopeStaff } from "@/lib/scope";
import { requireUser } from "@/lib/auth";
import { audit, notifyClub } from "@/lib/audit";
import { approveRegistration, logEvent, missingDocs, categoryFor, assertForeignQuota } from "@/lib/registration";
import { addCharge, feeAmount } from "@/lib/finance";
import { saveUpload, ALLOWED_IMG } from "@/lib/storage";
import { attempt, str, req, int, bool, UserError } from "@/lib/util";

// ======================= مراجعة الطلبات =======================
export async function reviewDoc(f: FormData) {
  const u = await requireUser("reg.review");
  const id = int(f, "id")!, docId = int(f, "docId")!;
  const ok = f.get("decision") === "approve";
  await attempt(`/registration/requests/${id}`, async () => {
    guard(await inScopeReg(u, id));
    const reason = str(f, "reason");
    if (!ok && !reason) throw new UserError("اكتب سبب رفض المستند ليظهر للنادي");
    const [d] = await db.select().from(registrationDocuments).where(and(eq(registrationDocuments.id, docId), eq(registrationDocuments.registrationId, id)));
    if (!d) throw new UserError("المستند غير موجود");
    await db.update(registrationDocuments)
      .set({ status: ok ? "APPROVED" : "REJECTED", rejectionReason: ok ? null : reason, reviewedAt: new Date(), reviewedBy: u.fullName })
      .where(eq(registrationDocuments.id, docId));
    await logEvent(db, id, u.fullName, ok ? "قبول مستند" : "رفض مستند", ok ? null : reason);
    await audit(u, ok ? "قبول مستند" : "رفض مستند", "RegistrationDocument", docId, reason);
    return ok ? "تم قبول المستند" : "تم رفض المستند";
  });
}

export async function approveAllDocs(f: FormData) {
  const u = await requireUser("reg.review");
  const id = int(f, "id")!;
  await attempt(`/registration/requests/${id}`, async () => {
    guard(await inScopeReg(u, id));
    await db.update(registrationDocuments)
      .set({ status: "APPROVED", reviewedAt: new Date(), reviewedBy: u.fullName, rejectionReason: null })
      .where(and(eq(registrationDocuments.registrationId, id), eq(registrationDocuments.status, "PENDING")));
    await logEvent(db, id, u.fullName, "قبول كل المستندات المعلقة");
    return "تم قبول المستندات المعلقة";
  });
}

export async function decide(f: FormData) {
  const u = await requireUser("reg.review");
  const id = int(f, "id")!;
  const decision = String(f.get("decision"));
  await attempt(`/registration/requests/${id}`, async () => {
    guard(await inScopeReg(u, id));
    const reason = str(f, "reason");
    const [r] = await db.select().from(registrations).where(eq(registrations.id, id));
    if (!r) throw new UserError("الطلب غير موجود");
    const [p] = await db.select().from(players).where(eq(players.id, r.playerId));
    if (decision === "approve") {
      const override = bool(f, "override");
      const pending = await db.select({ id: registrationDocuments.id }).from(registrationDocuments)
        .where(and(eq(registrationDocuments.registrationId, id), ne(registrationDocuments.status, "APPROVED"), ne(registrationDocuments.status, "REJECTED")));
      const miss = await missingDocs(id);
      if (!override) {
        if (miss.length) throw new UserError("مستندات إلزامية ناقصة أو مرفوضة: " + miss.map((m) => m.name).join("، "));
        if (pending.length) throw new UserError("توجد مستندات لم تُراجع بعد — اقبلها أو ارفضها أولًا");
        if (r.originResponse === "PENDING") throw new UserError("بانتظار رد النادي السابق — أو فعّل خيار تجاوز الشروط");
        if (r.originResponse === "OBJECTED") throw new UserError("النادي السابق معترض — اعتماد الطلب يحتاج تجاوز الشروط بقرار اللجنة");
      }
      if (!override) await assertForeignQuota(id);
      const fee = await feeAmount(`REG_${r.type}`, p.professionalLevel !== "AMATEUR");
      let number = "";
      await db.transaction(async (tx) => {
        number = await approveRegistration(tx, id, u.fullName, override ? `[بتجاوز الشروط] ${reason ?? ""}`.trim() : reason);
        await addCharge(tx, { clubId: r.clubId, category: "REG_FEE", description: `رسوم ${p.fullName} — ${number}`, amount: fee, refType: "registration", refId: id, createdBy: u.fullName });
        await notifyClub(r.clubId, "تم اعتماد قيد لاعب", `${p.fullName} — رقم القيد ${number}`, `/club/registrations/${id}`, tx);
        if (r.fromClubId) await notifyClub(r.fromClubId, "اعتُمد انتقال/إعارة أحد لاعبيكم", p.fullName, "/club/origin", tx);
        await audit(u, "اعتماد قيد", "Registration", id, { number, override }, tx);
      });
      return `تم اعتماد القيد برقم ${number}`;
    }
    if (!reason) throw new UserError("سبب القرار مطلوب ليظهر للنادي");
    if (!["SUBMITTED", "NEEDS_CORRECTION"].includes(r.status)) throw new UserError("لا يمكن اتخاذ قرار في هذه الحالة");
    const status = decision === "return" ? "NEEDS_CORRECTION" : "REJECTED";
    await db.transaction(async (tx) => {
      await tx.update(registrations).set({ status, decisionReason: reason, decidedAt: new Date(), decidedBy: u.fullName, updatedAt: new Date() }).where(eq(registrations.id, id));
      await logEvent(tx, id, u.fullName, status === "REJECTED" ? "رفض الطلب" : "إعادة للنادي للاستكمال", reason);
      await notifyClub(r.clubId, status === "REJECTED" ? "رُفض طلب قيد" : "طلب قيد يحتاج استكمال", `${p.fullName}: ${reason}`, `/club/registrations/${id}`, tx);
      await audit(u, status === "REJECTED" ? "رفض طلب" : "إعادة طلب", "Registration", id, reason, tx);
    });
    return status === "REJECTED" ? "تم رفض الطلب وإبلاغ النادي" : "أُعيد الطلب للنادي للاستكمال";
  });
}

/** تعديل لجنة القيد لبيانات لاعب (حتى بعد الاعتماد) */
export async function editPlayer(f: FormData) {
  const u = await requireUser("reg.edit");
  const id = int(f, "playerId")!;
  await attempt(`/registration/players/${id}`, async () => {
    guard(await inScopePlayer(u, id));
    const [before] = await db.select().from(players).where(eq(players.id, id));
    const nid = str(f, "nationalId");
    if (nid && !/^[0-9]{12}$/.test(nid)) throw new UserError("الرقم الوطني 12 رقمًا");
    const cardNo = str(f, "cardNo")?.replace(/\s+/g, "").toUpperCase() ?? null;
    if (cardNo) {
      const [dup] = await db.select({ id: players.id, n: players.fullName }).from(players).where(eq(players.cardNo, cardNo));
      if (dup && dup.id !== id) throw new UserError(`رقم البطاقة مستخدم للاعب آخر: ${dup.n}`);
    }
    const data = {
      ...(f.has("cardNo") ? { cardNo } : {}),
      fullName: req(f, "fullName", "الاسم").replace(/\s+/g, " "), fullNameEn: str(f, "fullNameEn"), motherName: str(f, "motherName"),
      nationalId: nid, passportNo: str(f, "passportNo"), dateOfBirth: req(f, "dateOfBirth", "تاريخ الميلاد"),
      placeOfBirth: str(f, "placeOfBirth"), gender: (str(f, "gender") ?? "MALE") as "MALE", nationality: str(f, "nationality") ?? "ليبي",
      isForeign: bool(f, "isForeign"), position: (str(f, "position") ?? "UNKNOWN") as "UNKNOWN",
      professionalLevel: (str(f, "professionalLevel") ?? "AMATEUR") as "AMATEUR", phone: str(f, "phone"), address: str(f, "address"), city: str(f, "city"),
    };
    const photo = f.get("photo") as File | null;
    const saved = photo && photo.size ? await saveUpload(photo, "photos", ALLOWED_IMG) : null;
    // الفئات الجديدة تُحسب قبل المعاملة (قاعدة البيانات المدمجة اتصال واحد)
    const recat: { regId: number; catId: number | null }[] = [];
    if (before.dateOfBirth !== data.dateOfBirth) {
      const regs = await db.select({ r: registrations, s: seasons }).from(registrations).innerJoin(seasons, eq(seasons.id, registrations.seasonId)).where(eq(registrations.playerId, id));
      for (const { r, s } of regs) recat.push({ regId: r.id, catId: (await categoryFor(data.dateOfBirth, s.startDate))?.id ?? null });
    }
    await db.transaction(async (tx) => {
      await tx.update(players).set(data).where(eq(players.id, id));
      if (saved) await tx.update(players).set({ photoKey: saved.key, photoHash: saved.hash }).where(eq(players.id, id));
      for (const x of recat) await tx.update(registrations).set({ categoryId: x.catId }).where(eq(registrations.id, x.regId));
      const changed = Object.fromEntries(Object.entries(data).filter(([k, v]) => (before as Record<string, unknown>)[k] !== v).map(([k, v]) => [k, [(before as Record<string, unknown>)[k], v]]));
      await audit(u, "تعديل بيانات لاعب", "Player", id, changed, tx);
    });
    return "تم حفظ بيانات اللاعب";
  });
}

export async function setPlayerStatus(f: FormData) {
  const u = await requireUser("reg.edit");
  const id = int(f, "playerId")!;
  await attempt(`/registration/players/${id}`, async () => {
    guard(await inScopePlayer(u, id));
    const status = str(f, "status") as "ACTIVE" | "RETIRED" | "BLOCKED";
    await db.update(players).set({ status, notes: str(f, "notes") }).where(eq(players.id, id));
    await audit(u, "تغيير حالة لاعب", "Player", id, status);
    return "تم تحديث حالة اللاعب";
  });
}

export async function updateRegistrationMeta(f: FormData) {
  const u = await requireUser("reg.edit");
  const id = int(f, "id")!;
  await attempt(`/registration/requests/${id}`, async () => {
    guard(await inScopeReg(u, id));
    await db.update(registrations).set({
      shirtNumber: int(f, "shirtNumber"),
      loanEndDate: str(f, "loanEndDate"), categoryId: int(f, "categoryId"), updatedAt: new Date(),
    }).where(eq(registrations.id, id));
    await logEvent(db, id, u.fullName, "تعديل بيانات القيد من اللجنة");
    await audit(u, "تعديل بيانات قيد", "Registration", id);
    return "تم الحفظ";
  });
}

/** شطب/إنهاء قيد معتمد (مثلاً بطلب النادي أو قرار اللجنة) */
export async function endRegistration(f: FormData) {
  const u = await requireUser("reg.edit");
  const id = int(f, "id")!;
  await attempt(`/registration/requests/${id}`, async () => {
    guard(await inScopeReg(u, id));
    const reason = req(f, "reason", "السبب");
    const [r] = await db.select().from(registrations).where(eq(registrations.id, id));
    if (r.status !== "APPROVED") throw new UserError("القيد غير ساري");
    await db.update(registrations).set({ status: "EXPIRED", decisionReason: reason, updatedAt: new Date() }).where(eq(registrations.id, id));
    await logEvent(db, id, u.fullName, "إنهاء / شطب القيد", reason);
    await notifyClub(r.clubId, "تم إنهاء قيد لاعب", reason, `/club/registrations/${id}`);
    await audit(u, "شطب قيد", "Registration", id, reason);
    return "تم إنهاء القيد";
  });
}

// ======================= الإيقافات =======================
export async function addSuspension(f: FormData) {
  const kind = str(f, "kind") === "MATCHES" ? "MATCHES" : "ADMIN";
  const u = await requireUser(kind === "ADMIN" ? "reg.suspend" : "comp.suspend");
  const back = str(f, "back") ?? "/registration/suspensions";
  await attempt(back, async () => {
    const playerId = int(f, "playerId");
    if (!playerId) throw new UserError("اختر اللاعب");
    guard(await inScopePlayer(u, playerId));
    if (int(f, "competitionId")) guard(await inScopeComp(u, int(f, "competitionId")));
    const reason = req(f, "reason", "السبب");
    const matchesTotal = kind === "MATCHES" ? int(f, "matchesTotal") : null;
    if (kind === "MATCHES" && (!matchesTotal || matchesTotal < 1)) throw new UserError("عدد المباريات مطلوب");
    const [s] = await db.insert(suspensions).values({
      playerId, kind, reason, matchesTotal, startDate: str(f, "startDate") ?? undefined, endDate: kind === "ADMIN" ? str(f, "endDate") : null,
      competitionId: int(f, "competitionId"), createdBy: u.fullName,
    }).returning();
    await audit(u, "إيقاف لاعب", "Suspension", s.id, { playerId, kind, reason, matchesTotal });
    const [r] = await db.select({ clubId: registrations.clubId }).from(registrations).where(and(eq(registrations.playerId, playerId), eq(registrations.status, "APPROVED"))).limit(1);
    if (r) await notifyClub(r.clubId, "إيقاف لاعب", reason, "/club/players");
    return "تم تسجيل الإيقاف";
  });
}

export async function liftSuspension(f: FormData) {
  const u = await requireUser("reg.suspend", "comp.suspend");
  const id = int(f, "id")!;
  const back = str(f, "back") ?? "/registration/suspensions";
  await attempt(back, async () => {
    const [s] = await db.select().from(suspensions).where(eq(suspensions.id, id));
    if (!s) throw new UserError("غير موجود");
    guard(await inScopePlayer(u, s.playerId));
    if (!u.can(s.kind === "ADMIN" ? "reg.suspend" : "comp.suspend")) throw new UserError("لا تملك صلاحية رفع هذا النوع من الإيقاف");
    await db.update(suspensions).set({ isLifted: true, liftedAt: new Date(), liftedBy: u.fullName }).where(eq(suspensions.id, id));
    await audit(u, "رفع إيقاف", "Suspension", id);
    return "تم رفع الإيقاف";
  });
}

// ======================= المواسم والفترات والإعدادات =======================
export async function saveSeason(f: FormData) {
  const u = await requireUser("reg.windows");
  await attempt("/registration/settings", async () => {
    const id = int(f, "id");
    const data = { name: req(f, "name", "اسم الموسم"), startDate: req(f, "startDate", "البداية"), endDate: req(f, "endDate", "النهاية"), notes: str(f, "notes") };
    if (data.endDate <= data.startDate) throw new UserError("نهاية الموسم يجب أن تكون بعد بدايته");
    if (id) await db.update(seasons).set(data).where(eq(seasons.id, id));
    else await db.insert(seasons).values(data);
    await audit(u, id ? "تعديل موسم" : "إضافة موسم", "Season", id, data);
    return "تم حفظ الموسم";
  });
}

export async function setCurrentSeason(f: FormData) {
  const u = await requireUser("reg.windows");
  await attempt("/registration/settings", async () => {
    const id = int(f, "id")!;
    await db.transaction(async (tx) => {
      await tx.update(seasons).set({ isCurrent: false });
      await tx.update(seasons).set({ isCurrent: true }).where(eq(seasons.id, id));
    });
    await audit(u, "تعيين الموسم الحالي", "Season", id);
    return "تم تعيين الموسم الحالي";
  });
}

/** إغلاق موسم: القيود المعتمدة فيه تصبح منتهية (ليُجدّدها النادي في الموسم الجديد) */
export async function closeSeason(f: FormData) {
  const u = await requireUser("reg.windows");
  await attempt("/registration/settings", async () => {
    const id = int(f, "id")!;
    const [s] = await db.select().from(seasons).where(eq(seasons.id, id));
    if (s.isCurrent) throw new UserError("لا يمكن إغلاق الموسم الحالي — عيّن موسمًا جديدًا أولًا");
    const res = await db.update(registrations).set({ status: "EXPIRED", updatedAt: new Date() })
      .where(and(eq(registrations.seasonId, id), eq(registrations.status, "APPROVED"))).returning({ id: registrations.id });
    await db.update(registrations).set({ status: "CANCELLED", decisionReason: "أُغلق الموسم", updatedAt: new Date() })
      .where(and(eq(registrations.seasonId, id), inArray(registrations.status, ["DRAFT", "SUBMITTED", "NEEDS_CORRECTION"])));
    await audit(u, "إغلاق موسم", "Season", id, { expired: res.length });
    return `أُغلق الموسم — ${res.length} قيد أصبح منتهيًا`;
  });
}

export async function saveWindow(f: FormData) {
  const u = await requireUser("reg.windows");
  await attempt("/registration/settings", async () => {
    const id = int(f, "id");
    const data = {
      seasonId: int(f, "seasonId")!, label: req(f, "label", "اسم الفترة"), startDate: req(f, "startDate", "البداية"), endDate: req(f, "endDate", "النهاية"),
      isException: bool(f, "isException"), clubId: int(f, "clubId"), isClosed: bool(f, "isClosed"),
    };
    if (data.endDate < data.startDate) throw new UserError("تاريخ النهاية قبل البداية");
    if (id) await db.update(registrationWindows).set(data).where(eq(registrationWindows.id, id));
    else await db.insert(registrationWindows).values(data);
    await audit(u, id ? "تعديل فترة قيد" : "فتح فترة قيد", "RegistrationWindow", id, data);
    return "تم حفظ فترة القيد";
  });
}

export async function toggleWindow(f: FormData) {
  const u = await requireUser("reg.windows");
  await attempt("/registration/settings", async () => {
    const id = int(f, "id")!;
    const [w] = await db.select().from(registrationWindows).where(eq(registrationWindows.id, id));
    await db.update(registrationWindows).set({ isClosed: !w.isClosed }).where(eq(registrationWindows.id, id));
    await audit(u, w.isClosed ? "إعادة فتح فترة" : "إغلاق فترة يدويًا", "RegistrationWindow", id);
    return w.isClosed ? "أُعيد فتح الفترة" : "أُغلقت الفترة";
  });
}

export async function deleteWindow(f: FormData) {
  const u = await requireUser("reg.windows");
  await attempt("/registration/settings", async () => {
    const id = int(f, "id")!;
    await db.delete(registrationWindows).where(eq(registrationWindows.id, id));
    await audit(u, "حذف فترة", "RegistrationWindow", id);
    return "تم الحذف";
  });
}

export async function saveCategory(f: FormData) {
  const u = await requireUser("reg.windows");
  await attempt("/registration/settings#cats", async () => {
    const id = int(f, "id");
    const data = { name: req(f, "name", "الاسم"), maxAge: int(f, "maxAge"), maxForeign: int(f, "maxForeign"), sortOrder: int(f, "sortOrder") ?? 0, isActive: f.get("isActive") ? bool(f, "isActive") : true };
    if (id) await db.update(ageCategories).set(data).where(eq(ageCategories.id, id));
    else await db.insert(ageCategories).values(data);
    await audit(u, "حفظ فئة عمرية", "AgeCategory", id, data);
    return "تم الحفظ";
  });
}

export async function saveDocType(f: FormData) {
  const u = await requireUser("reg.windows");
  await attempt("/registration/settings#docs", async () => {
    const id = int(f, "id");
    const data = {
      name: req(f, "name", "الاسم"), requiredFor: f.getAll("requiredFor").map(String), onlyProfessional: bool(f, "onlyProfessional"),
      onlyMinor: bool(f, "onlyMinor"), onlyForeign: bool(f, "onlyForeign"), sortOrder: int(f, "sortOrder") ?? 0, isActive: bool(f, "isActive"),
    };
    if (id) await db.update(documentTypes).set(data).where(eq(documentTypes.id, id));
    else await db.insert(documentTypes).values(data);
    await audit(u, "حفظ نوع مستند", "DocumentType", id, data);
    return "تم الحفظ";
  });
}

export async function saveRegSettings(f: FormData) {
  const u = await requireUser("reg.windows");
  await attempt("/registration/settings", async () => {
    for (const k of ["require_origin_consent"]) {
      const v = bool(f, k) ? "1" : "0";
      await db.insert(settings).values({ key: k, value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v } });
    }
    await audit(u, "تعديل إعدادات القيد", "Setting", null);
    return "تم الحفظ";
  });
}

// ======================= قوائم الفرق =======================
export async function saveListTemplate(f: FormData) {
  const u = await requireUser("reg.lists");
  await attempt("/registration/lists", async () => {
    guard(!u.divisionId);
    const id = int(f, "id");
    const columns = f.getAll("col").map(String);
    if (!columns.length) throw new UserError("اختر عمودًا واحدًا على الأقل");
    const data = {
      name: req(f, "name", "اسم القالب"), columns,
      options: { title: str(f, "title") ?? undefined, landscape: bool(f, "landscape"), showStamp: bool(f, "showStamp"), signatures: (str(f, "signatures") ?? "").split("\n").map((x) => x.trim()).filter(Boolean) },
    };
    if (id) await db.update(listTemplates).set(data).where(eq(listTemplates.id, id));
    else await db.insert(listTemplates).values(data);
    await audit(u, "حفظ قالب قائمة", "ListTemplate", id, data.name);
    return "تم حفظ القالب";
  });
}

export async function deleteListTemplate(f: FormData) {
  const u = await requireUser("reg.lists");
  await attempt("/registration/lists", async () => {
    guard(!u.divisionId);
    await db.delete(listTemplates).where(eq(listTemplates.id, int(f, "id")!));
    await audit(u, "حذف قالب قائمة", "ListTemplate", int(f, "id"));
    return "تم الحذف";
  });
}

// ======================= البطاقات =======================
export async function saveCardTemplate(data: { id?: number; name: string; widthMm: number; heightMm: number; front: CardElement[]; back: CardElement[] | null; frontBg: string | null; backBg: string | null; isDefault: boolean }) {
  const u = await requireUser("cards.design");
  if (!data.name.trim()) return { error: "اسم القالب مطلوب" };
  const clean = (els: CardElement[] | null) =>
    els?.map((e) => ({ ...e, x: +e.x.toFixed(2), y: +e.y.toFixed(2), w: +e.w.toFixed(2), h: +e.h.toFixed(2) })) ?? null;
  const row = { name: data.name.trim(), widthMm: data.widthMm, heightMm: data.heightMm, front: clean(data.front)!, back: clean(data.back), frontBg: data.frontBg, backBg: data.backBg, isDefault: data.isDefault, updatedAt: new Date() };
  let id = data.id;
  await db.transaction(async (tx) => {
    if (row.isDefault) await tx.update(cardTemplates).set({ isDefault: false });
    if (id) await tx.update(cardTemplates).set(row).where(eq(cardTemplates.id, id));
    else id = (await tx.insert(cardTemplates).values(row).returning())[0].id;
  });
  await audit(u, "حفظ قالب بطاقة", "CardTemplate", id, row.name);
  revalidatePath("/registration/cards/templates");
  return { id };
}

export async function uploadCardImage(f: FormData) {
  await requireUser("cards.design");
  try {
    const s = await saveUpload(f.get("file") as File, "cards", ALLOWED_IMG);
    return { key: s.key };
  } catch (e) {
    return { error: e instanceof UserError ? e.message : "تعذّر رفع الصورة" };
  }
}

export async function deleteCardTemplate(f: FormData) {
  const u = await requireUser("cards.design");
  await attempt("/registration/cards/templates", async () => {
    await db.delete(cardTemplates).where(eq(cardTemplates.id, int(f, "id")!));
    await audit(u, "حذف قالب بطاقة", "CardTemplate", int(f, "id"));
    return "تم الحذف";
  });
}

/** تسجيل طباعة البطاقات (يُستدعى من صفحة الطباعة بعد الطباعة) */
export async function recordPrints(regIds: number[], templateId: number | null, isReplacement: boolean, reason: string | null) {
  const u = await requireUser("cards.print");
  const sc = await scopeOf(u);
  let ids = regIds.filter((n) => Number.isInteger(n));
  if (sc && ids.length) ids = (await db.select({ id: registrations.id }).from(registrations).where(and(inArray(registrations.id, ids), inArray(registrations.clubId, sc.clubIds.length ? sc.clubIds : [-1])))).map((x) => x.id);
  if (!ids.length) return { count: 0 };
  const fee = isReplacement ? await feeAmount("CARD_REPLACEMENT") : 0;
  await db.transaction(async (tx) => {
    const printed = await tx.insert(cardPrints).values(ids.map((registrationId) => ({ registrationId, templateId, printedBy: u.fullName, isReplacement, reason }))).returning();
    if (fee > 0)
      for (const p of printed) {
        const [r] = await tx.select({ clubId: registrations.clubId, number: registrations.number }).from(registrations).where(eq(registrations.id, p.registrationId));
        await addCharge(tx, { clubId: r.clubId, category: "CARD_FEE", description: `بطاقة بديلة — ${r.number}`, amount: fee, refType: "cardprint", refId: p.id, createdBy: u.fullName });
      }
    for (const id of ids) {
      const [r] = await tx.select({ c: registrations.cardPrintCount }).from(registrations).where(eq(registrations.id, id));
      await tx.update(registrations).set({ cardPrintCount: (r?.c ?? 0) + 1, lastCardPrintedAt: new Date() }).where(eq(registrations.id, id));
    }
  });
  await audit(u, isReplacement ? "طباعة بطاقة بديلة" : "طباعة بطاقات", "CardPrint", null, { count: ids.length, templateId });
  return { count: ids.length };
}

// ======================= الإداريون والجهاز الفني =======================
export async function decideStaff(f: FormData) {
  const u = await requireUser("reg.staff");
  await attempt("/registration/staff", async () => {
    const id = int(f, "id")!;
    guard(await inScopeStaff(u, id));
    const decision = String(f.get("decision"));
    const reason = str(f, "reason");
    const [s] = await db.select().from(staff).where(eq(staff.id, id));
    if (!s || s.status !== "SUBMITTED") throw new UserError("الطلب غير متاح");
    if (decision !== "approve" && !reason) throw new UserError("اكتب السبب ليظهر للنادي");
    const status = decision === "approve" ? "APPROVED" : decision === "return" ? "NEEDS_CORRECTION" : "REJECTED";
    const fee = status === "APPROVED" ? await feeAmount("STAFF_REG") : 0;
    await db.transaction(async (tx) => {
      await tx.update(staff).set({ status, decisionReason: reason, decidedBy: u.fullName, decidedAt: new Date() }).where(eq(staff.id, id));
      if (fee > 0) await addCharge(tx, { clubId: s.clubId, category: "STAFF_FEE", description: `رسوم قيد ${s.fullName}`, amount: fee, refType: "staff", refId: id, createdBy: u.fullName });
      await notifyClub(s.clubId, status === "APPROVED" ? "اعتُمد قيد إداري" : "قرار بشأن قيد إداري", `${s.fullName}${reason ? ": " + reason : ""}`, "/club/staff", tx);
      await audit(u, "قرار قيد إداري", "Staff", id, { status, reason }, tx);
    });
    return status === "APPROVED" ? "تم الاعتماد" : "تم إبلاغ النادي";
  });
}
