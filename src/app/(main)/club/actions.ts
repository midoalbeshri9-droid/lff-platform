"use server";
import { and, eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import {
  players, registrations, registrationDocuments, documentTypes, matches, users, seasons, contracts, staff, matchRequests, staffRoleEnum,
} from "@/db/schema";
import { requireClubUser } from "@/lib/auth";
import { audit, notifyRoles, notifyClub, notifyStaff } from "@/lib/audit";
import {
  getCurrentSeason, openWindow, categoryFor, findDuplicates, activeRegistration, lastApproved, logEvent, missingDocs, getSetting,
  assertForeignQuota, needsContract, photoDuplicates,
} from "@/lib/registration";
import { clubBlockReason } from "@/lib/finance";
import { missingForSubmit, runningContract } from "@/lib/contracts";
import { saveLineup } from "@/lib/lineup";
import { saveUpload, deleteObject, ALLOWED_IMG } from "@/lib/storage";
import { attempt, str, req, int, bool, UserError, back, reqEmail, reqPhone, num } from "@/lib/util";
import { ensureUniqueContact } from "@/lib/users";
import { sendActivation, unusableHash } from "@/lib/tokens";

const REG_ROLES = ["REG_HEAD", "REG_STAFF"] as const;

async function ownReg(regId: number, clubId: number) {
  const [r] = await db.select().from(registrations).where(and(eq(registrations.id, regId), eq(registrations.clubId, clubId)));
  if (!r) throw new UserError("الطلب غير موجود");
  return r;
}
const editable = (s: string) => s === "DRAFT" || s === "NEEDS_CORRECTION";

function playerFields(f: FormData) {
  const nid = str(f, "nationalId");
  if (nid && !/^[0-9]{12}$/.test(nid)) throw new UserError("الرقم الوطني يجب أن يكون 12 رقمًا");
  const isForeign = bool(f, "isForeign");
  if (!nid && !str(f, "passportNo")) throw new UserError("أدخل الرقم الوطني أو رقم الجواز");
  return {
    fullName: req(f, "fullName", "الاسم الرباعي").replace(/\s+/g, " "),
    fullNameEn: str(f, "fullNameEn"),
    motherName: str(f, "motherName"),
    nationalId: nid,
    passportNo: str(f, "passportNo"),
    dateOfBirth: req(f, "dateOfBirth", "تاريخ الميلاد"),
    placeOfBirth: str(f, "placeOfBirth"),
    gender: (str(f, "gender") ?? "MALE") as "MALE" | "FEMALE",
    nationality: str(f, "nationality") ?? (isForeign ? "" : "ليبي"),
    isForeign,
    position: (str(f, "position") ?? "UNKNOWN") as "UNKNOWN",
    professionalLevel: (str(f, "professionalLevel") ?? "AMATEUR") as "AMATEUR",
    phone: str(f, "phone"),
    address: str(f, "address"),
    city: str(f, "city"),
  };
}

/** إضافة لاعب جديد (غير مسجل في المنظومة) مع إنشاء طلب قيد جديد كمسودة */
export async function createPlayerAndRequest(f: FormData) {
  const u = await requireClubUser("club.edit");
  let regId = 0;
  await attempt("/club/players/new", async () => {
    const season = await getCurrentSeason();
    if (!season) throw new UserError("لا يوجد موسم حالي — تواصل مع لجنة القيد");
    const p = playerFields(f);
    if (p.nationalId) {
      const [ex] = await db.select({ id: players.id }).from(players).where(eq(players.nationalId, p.nationalId));
      if (ex) throw new UserError("هذا الرقم الوطني مسجل مسبقًا — ابحث عنه وأنشئ طلب انتقال أو تجديد");
    }
    const photo = f.get("photo") as File | null;
    const dups: { id: number; fullName: string; nationalId: string | null; byPhoto?: boolean }[] = await findDuplicates(p.fullName, p.dateOfBirth);
    const cat = await categoryFor(p.dateOfBirth, season.startDate);
    let photoKey: string | null = null, photoHash: string | null = null;
    if (photo && photo.size) {
      const sv = await saveUpload(photo, "photos", ALLOWED_IMG);
      photoKey = sv.key; photoHash = sv.hash;
    }
    const pd = await photoDuplicates(photoHash);
    if (pd.length) dups.push(...pd.map((x) => ({ ...x, nationalId: null, byPhoto: true })));
    await db.transaction(async (tx) => {
      const [pl] = await tx.insert(players).values({ ...p, photoKey, photoHash, createdByClubId: u.clubId }).returning();
      const [r] = await tx.insert(registrations).values({
        playerId: pl.id, clubId: u.clubId, seasonId: season.id, type: "NEW", status: "DRAFT", categoryId: cat?.id,
        shirtNumber: int(f, "shirtNumber"),
        possibleDuplicates: dups.length ? dups.map((d) => `#${d.id} ${d.fullName}${"byPhoto" in d ? " (نفس الصورة)" : ""}`).join("، ") : null,
      }).returning();
      regId = r.id;
      await logEvent(tx, r.id, u.fullName, "إنشاء طلب قيد جديد");
      await audit(u, "إضافة لاعب", "Player", pl.id, { name: pl.fullName, club: u.clubName }, tx);
    });
    return;
  }).catch((e) => {
    if (regId) redirect(`/club/registrations/${regId}?ok=${encodeURIComponent("تم إنشاء الطلب — ارفع المستندات ثم أرسله")}`);
    throw e;
  });
}

/** طلب لاعب مسجل مسبقًا: تجديد أو انتقال أو إعارة أو عودة من إعارة */
export async function requestExisting(f: FormData) {
  const u = await requireClubUser("club.edit");
  const playerId = int(f, "playerId")!;
  const type = (str(f, "type") ?? "RENEWAL") as "RENEWAL" | "TRANSFER" | "LOAN" | "LOAN_RETURN" | "NEW";
  let regId = 0;
  await attempt(`/club/players/new?q=${playerId}`, async () => {
    const season = await getCurrentSeason();
    if (!season) throw new UserError("لا يوجد موسم حالي");
    const [p] = await db.select().from(players).where(eq(players.id, playerId));
    if (!p) throw new UserError("اللاعب غير موجود");
    if (p.status !== "ACTIVE") throw new UserError("اللاعب غير نشط (معتزل أو موقوف إداريًا)");
    const open = await db
      .select({ id: registrations.id })
      .from(registrations)
      .where(and(eq(registrations.playerId, playerId), eq(registrations.seasonId, season.id), inArray(registrations.status, ["DRAFT", "SUBMITTED", "NEEDS_CORRECTION"])));
    if (open.length) throw new UserError("يوجد طلب مفتوح لهذا اللاعب في الموسم الحالي (لدى ناديكم أو نادٍ آخر)");
    const active = await activeRegistration(playerId, season.id);
    if (active?.clubId === u.clubId) throw new UserError("اللاعب مقيد لدى ناديكم في الموسم الحالي");
    const last = active ? null : await lastApproved(playerId);
    const fromClubId = active?.clubId ?? (last && last.r.clubId !== u.clubId ? last.r.clubId : null);
    let t = type;
    if (!active && !fromClubId) t = last ? "RENEWAL" : "NEW";
    if (active && !["TRANSFER", "LOAN", "LOAN_RETURN"].includes(t)) t = "TRANSFER";
    if (!active && fromClubId && t === "RENEWAL") t = "TRANSFER";
    const needOrigin = !!fromClubId && (t === "TRANSFER" || t === "LOAN") && (await getSetting("require_origin_consent", "1")) === "1";
    const cat = await categoryFor(p.dateOfBirth, season.startDate);
    await db.transaction(async (tx) => {
      const [r] = await tx.insert(registrations).values({
        playerId, clubId: u.clubId, seasonId: season.id, type: t, status: "DRAFT", categoryId: cat?.id, fromClubId,
        originResponse: needOrigin ? "PENDING" : "NOT_REQUIRED", loanEndDate: str(f, "loanEndDate"),
      }).returning();
      regId = r.id;
      await logEvent(tx, r.id, u.fullName, "إنشاء طلب", t);
      await audit(u, "إنشاء طلب قيد", "Registration", r.id, { player: p.fullName, type: t }, tx);
    });
  }).catch((e) => {
    if (regId) redirect(`/club/registrations/${regId}?ok=${encodeURIComponent("تم إنشاء الطلب — أكمل البيانات والمستندات ثم أرسله")}`);
    throw e;
  });
}

export async function updateDraft(f: FormData) {
  const u = await requireClubUser("club.edit");
  const id = int(f, "id")!;
  await attempt(`/club/registrations/${id}`, async () => {
    const r = await ownReg(id, u.clubId);
    if (!editable(r.status)) throw new UserError("لا يمكن تعديل طلب بعد إرساله");
    const [p] = await db.select().from(players).where(eq(players.id, r.playerId));
    // بيانات اللاعب الأساسية: يعدّلها النادي فقط إذا كان هو من أنشأه ولم يُعتمد له أي قيد بعد
    const everApproved = (await lastApproved(p.id)) != null;
    // كل الاستعلامات المساعدة قبل المعاملة (قاعدة البيانات المدمجة اتصال واحد)
    const pf = p.createdByClubId === u.clubId && !everApproved ? playerFields(f) : null;
    const [sea] = await db.select().from(seasons).where(eq(seasons.id, r.seasonId));
    const cat = pf ? await categoryFor(pf.dateOfBirth, sea.startDate) : null;
    const photo = f.get("photo") as File | null;
    const saved = photo && photo.size ? await saveUpload(photo, "photos", ALLOWED_IMG) : null;
    const pd = saved ? await photoDuplicates(saved.hash, p.id) : [];
    await db.transaction(async (tx) => {
      if (pf) {
        await tx.update(players).set(pf).where(eq(players.id, p.id));
        await tx.update(registrations).set({ categoryId: cat?.id }).where(eq(registrations.id, id));
      } else {
        await tx.update(players).set({
          phone: str(f, "phone"), address: str(f, "address"), city: str(f, "city"),
          position: (str(f, "position") ?? p.position) as "UNKNOWN",
          professionalLevel: (str(f, "professionalLevel") ?? p.professionalLevel) as "AMATEUR",
        }).where(eq(players.id, p.id));
      }
      if (saved) {
        await tx.update(players).set({ photoKey: saved.key, photoHash: saved.hash }).where(eq(players.id, p.id));
        if (pd.length) await tx.update(registrations).set({ possibleDuplicates: [r.possibleDuplicates, ...pd.map((x) => `#${x.id} ${x.fullName} (نفس الصورة)`)].filter(Boolean).join("، ") }).where(eq(registrations.id, id));
      }
      await tx.update(registrations).set({
        shirtNumber: int(f, "shirtNumber"),
        loanEndDate: str(f, "loanEndDate"), parentalConsent: bool(f, "parentalConsent"), notes: str(f, "notes"), updatedAt: new Date(),
      }).where(eq(registrations.id, id));
      await audit(u, "تعديل طلب", "Registration", id, null, tx);
    });
    return "تم حفظ البيانات";
  });
}

export async function uploadDocument(f: FormData) {
  const u = await requireClubUser("club.edit");
  const id = int(f, "id")!;
  await attempt(`/club/registrations/${id}`, async () => {
    const r = await ownReg(id, u.clubId);
    if (!editable(r.status)) throw new UserError("لا يمكن رفع مستندات لطلب مُرسل");
    const typeId = int(f, "documentTypeId");
    if (!typeId) throw new UserError("اختر نوع المستند");
    const [t] = await db.select().from(documentTypes).where(eq(documentTypes.id, typeId));
    if (!t) throw new UserError("نوع المستند غير صحيح");
    const s = await saveUpload(f.get("file") as File, `docs/${u.clubId}`);
    await db.insert(registrationDocuments).values({
      registrationId: id, documentTypeId: typeId, fileKey: s.key, originalName: s.name, mime: s.mime, size: s.size, uploadedBy: u.fullName,
    });
    await logEvent(db, id, u.fullName, "رفع مستند", t.name);
    return `تم رفع: ${t.name}`;
  });
}

export async function deleteDocument(f: FormData) {
  const u = await requireClubUser("club.edit");
  const id = int(f, "id")!, docId = int(f, "docId")!;
  await attempt(`/club/registrations/${id}`, async () => {
    const r = await ownReg(id, u.clubId);
    if (!editable(r.status)) throw new UserError("لا يمكن الحذف بعد الإرسال");
    const [d] = await db.select().from(registrationDocuments).where(and(eq(registrationDocuments.id, docId), eq(registrationDocuments.registrationId, id)));
    if (!d || d.status === "APPROVED") throw new UserError("لا يمكن حذف مستند مقبول");
    await db.delete(registrationDocuments).where(eq(registrationDocuments.id, docId));
    await deleteObject(d.fileKey);
    return "تم حذف المستند";
  });
}

export async function submitRequest(f: FormData) {
  const u = await requireClubUser("club.submit");
  const id = int(f, "id")!;
  await attempt(`/club/registrations/${id}`, async () => {
    const r = await ownReg(id, u.clubId);
    if (!editable(r.status)) throw new UserError("الطلب مُرسل مسبقًا");
    const block = await clubBlockReason(u.clubId);
    if (block) throw new UserError(block);
    const w = await openWindow(r.seasonId, u.clubId);
    if (!w) throw new UserError("فترة القيد مغلقة حاليًا — لا يمكن إرسال الطلبات");
    const miss = await missingDocs(id);
    if (miss.length) throw new UserError("مستندات إلزامية ناقصة: " + miss.map((m) => m.name).join("، "));
    const [p] = await db.select().from(players).where(eq(players.id, r.playerId));
    if (!p.photoKey) throw new UserError("صورة اللاعب الشخصية مطلوبة");
    let contractId = 0;
    if (needsContract(p.professionalLevel) && r.type !== "LOAN") {
      const [c0] = await db.select().from(contracts).where(eq(contracts.registrationId, id));
      const c = c0 && c0.status !== "TERMINATED" ? c0 : await runningContract(r.playerId, u.clubId); // التجديد يغطيه عقد ساري متعدد المواسم
      if (!c) throw new UserError("عقد اللاعب مطلوب للمحترف أو الهاوي تحت العقد — اكتبه من قسم «العقد» في الطلب");
      if (c.status !== "ACTIVE") {
        const miss = missingForSubmit(c);
        if (miss.length) throw new UserError("عقد اللاعب غير مكتمل: " + miss.join("، "));
        contractId = c.id;
      }
    }
    await assertForeignQuota(id);
    await db.transaction(async (tx) => {
      await tx.update(registrations).set({ status: "SUBMITTED", submittedAt: new Date(), submittedBy: u.fullName, updatedAt: new Date() }).where(eq(registrations.id, id));
      if (contractId) await tx.update(contracts).set({ status: "SUBMITTED", submittedAt: new Date(), updatedAt: new Date() }).where(eq(contracts.id, contractId));
      await logEvent(tx, id, u.fullName, r.status === "NEEDS_CORRECTION" ? "إعادة إرسال بعد الاستكمال" : "إرسال إلى لجنة القيد", w.label);
      await notifyStaff([...REG_ROLES], `طلب قيد جديد — ${u.clubName}`, p.fullName, `/registration/requests/${id}`, { clubId: u.clubId }, tx);
      if (r.originResponse === "PENDING" && r.fromClubId)
        await notifyClub(r.fromClubId, "طلب انتقال أحد لاعبيكم", `${p.fullName} — إلى ${u.clubName}`, "/club/origin", tx);
      await audit(u, "إرسال طلب", "Registration", id, null, tx);
    });
    return "تم إرسال الطلب إلى لجنة القيد";
  });
}

export async function cancelRequest(f: FormData) {
  const u = await requireClubUser("club.edit");
  const id = int(f, "id")!;
  await attempt(`/club/registrations/${id}`, async () => {
    const r = await ownReg(id, u.clubId);
    if (!["DRAFT", "NEEDS_CORRECTION", "SUBMITTED"].includes(r.status)) throw new UserError("لا يمكن إلغاء هذا الطلب");
    await db.update(registrations).set({ status: "CANCELLED", updatedAt: new Date() }).where(eq(registrations.id, id));
    await db.update(contracts).set({ status: "TERMINATED", terminatedAt: new Date(), terminationReason: "أُلغي طلب القيد", updatedAt: new Date() }).where(and(eq(contracts.registrationId, id), inArray(contracts.status, ["DRAFT", "RETURNED"])));
    await logEvent(db, id, u.fullName, "إلغاء الطلب من النادي");
    await audit(u, "إلغاء طلب", "Registration", id);
    return "تم إلغاء الطلب";
  });
}

/** رد النادي السابق على طلب انتقال/إعارة لاعبه */
export async function respondOrigin(f: FormData) {
  const u = await requireClubUser("club.origin");
  const id = int(f, "id")!;
  const agree = f.get("decision") === "agree";
  await attempt("/club/origin", async () => {
    const [r] = await db.select().from(registrations).where(and(eq(registrations.id, id), eq(registrations.fromClubId, u.clubId)));
    if (!r || r.originResponse !== "PENDING") throw new UserError("الطلب غير متاح للرد");
    const reason = str(f, "reason");
    if (!agree && !reason) throw new UserError("سبب الاعتراض مطلوب");
    await db.update(registrations).set({ originResponse: agree ? "AGREED" : "OBJECTED", originReason: reason, originRespondedAt: new Date() }).where(eq(registrations.id, id));
    await logEvent(db, id, `${u.fullName} (${u.clubName})`, agree ? "موافقة النادي السابق" : "اعتراض النادي السابق", reason);
    await notifyStaff([...REG_ROLES], agree ? "موافقة نادٍ على انتقال لاعب" : "اعتراض نادٍ على انتقال لاعب", u.clubName, `/registration/requests/${id}`, { clubId: r.clubId });
    await notifyClub(r.clubId, agree ? "وافق النادي السابق على الانتقال" : "اعترض النادي السابق على الانتقال", reason, `/club/registrations/${id}`);
    await audit(u, agree ? "موافقة على انتقال" : "اعتراض على انتقال", "Registration", id, reason);
    return agree ? "تم تسجيل الموافقة" : "تم تسجيل الاعتراض وإبلاغ لجنة القيد";
  });
}

/** إرسال قائمة المباراة من النادي — يُفحص كل لاعب تلقائيًا مقابل بيانات لجنة القيد */
export async function saveClubLineup(f: FormData) {
  const u = await requireClubUser("club.lineups");
  const matchId = int(f, "matchId")!;
  await attempt(`/club/matches/${matchId}`, async () => {
    const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
    if (!m || (m.homeClubId !== u.clubId && m.awayClubId !== u.clubId)) throw new UserError("المباراة غير متاحة");
    if (m.status !== "SCHEDULED" && m.status !== "POSTPONED") throw new UserError("انتهى وقت إرسال القائمة");
    if (m.kickoff && m.kickoff.getTime() < Date.now()) throw new UserError("بدأت المباراة — لا يمكن تعديل القائمة");
    await saveLineup(matchId, u.clubId, f);
    await audit(u, "إرسال قائمة مباراة", "Match", matchId, { club: u.clubName });
    return "تم حفظ القائمة";
  });
}

// ---------------- مستخدمو النادي (لمدير الحساب) ----------------
export async function createClubUser(f: FormData) {
  const u = await requireClubUser("club.view");
  if (u.role !== "CLUB_MANAGER") back("/club/users", { err: "هذه العملية لمدير حساب النادي فقط" });
  await attempt("/club/users", async () => {
    const role = str(f, "role") === "CLUB_VIEWER" ? "CLUB_VIEWER" : "CLUB_EMPLOYEE";
    const username = req(f, "username", "اسم المستخدم").toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new UserError("اسم المستخدم: حروف إنجليزية وأرقام فقط");
    const email = reqEmail(f), phone = reqPhone(f);
    await ensureUniqueContact(email, phone);
    const [n] = await db.insert(users).values({
      username, fullName: req(f, "fullName", "الاسم"), phone, email, role, clubId: u.clubId, passwordHash: unusableHash(), isVerified: false,
    }).returning();
    const r = await sendActivation(n);
    await audit(u, "إضافة مستخدم نادٍ", "User", n.id, { username, role });
    return r.sent ? "تمت إضافة المستخدم — أُرسل رابط التفعيل إلى بريده" : "تمت إضافة المستخدم — البريد غير مُعدّ بعد، اطلب من الاتحاد إرسال رابط التفعيل";
  });
}

export async function toggleClubUser(f: FormData) {
  const u = await requireClubUser("club.view");
  const id = int(f, "uid")!;
  await attempt("/club/users", async () => {
    if (u.role !== "CLUB_MANAGER") throw new UserError("لمدير الحساب فقط");
    const [t] = await db.select().from(users).where(and(eq(users.id, id), eq(users.clubId, u.clubId)));
    if (!t || t.id === u.id) throw new UserError("غير مسموح");
    await db.update(users).set({ isActive: !t.isActive, sessionVersion: t.sessionVersion + 1 }).where(eq(users.id, id));
    await audit(u, t.isActive ? "تعطيل مستخدم" : "تفعيل مستخدم", "User", id);
    return t.isActive ? "تم تعطيل الحساب" : "تم تفعيل الحساب";
  });
}


// ---------------- الإداريون والجهاز الفني ----------------
const staffRole = (r: string) => {
  if (!(staffRoleEnum.enumValues as readonly string[]).includes(r)) throw new UserError("الصفة غير صحيحة");
  return r as (typeof staffRoleEnum.enumValues)[number];
};
export async function saveStaff(f: FormData) {
  const u = await requireClubUser("club.edit");
  await attempt("/club/staff", async () => {
    const season = await getCurrentSeason();
    if (!season) throw new UserError("لا يوجد موسم حالي");
    const id = int(f, "id");
    const data = {
      clubId: u.clubId, seasonId: season.id, fullName: req(f, "fullName", "الاسم"), role: staffRole(req(f, "role", "الصفة")),
      nationalId: str(f, "nationalId"), nationality: str(f, "nationality") ?? "ليبي", dateOfBirth: str(f, "dateOfBirth"),
      phone: str(f, "phone"), licenseNo: str(f, "licenseNo"), licenseLevel: str(f, "licenseLevel"),
    };
    const photo = f.get("photo") as File | null, doc = f.get("document") as File | null;
    const photoKey = photo && photo.size ? (await saveUpload(photo, "photos", ALLOWED_IMG)).key : undefined;
    const documentKey = doc && doc.size ? (await saveUpload(doc, `docs/${u.clubId}`)).key : undefined;
    if (id) {
      const [ex] = await db.select().from(staff).where(and(eq(staff.id, id), eq(staff.clubId, u.clubId)));
      if (!ex || !["DRAFT", "NEEDS_CORRECTION"].includes(ex.status)) throw new UserError("لا يمكن التعديل بعد الإرسال");
      await db.update(staff).set({ ...data, ...(photoKey ? { photoKey } : {}), ...(documentKey ? { documentKey } : {}) }).where(eq(staff.id, id));
    } else await db.insert(staff).values({ ...data, photoKey, documentKey });
    await audit(u, id ? "تعديل إداري" : "إضافة إداري", "Staff", id, data.fullName);
    return "تم الحفظ — أرسله للجنة القيد للاعتماد";
  });
}

export async function submitStaff(f: FormData) {
  const u = await requireClubUser("club.submit");
  await attempt("/club/staff", async () => {
    const id = int(f, "id")!;
    const [ex] = await db.select().from(staff).where(and(eq(staff.id, id), eq(staff.clubId, u.clubId)));
    if (!ex || !["DRAFT", "NEEDS_CORRECTION"].includes(ex.status)) throw new UserError("غير متاح للإرسال");
    if (!ex.photoKey) throw new UserError("الصورة الشخصية مطلوبة");
    const block = await clubBlockReason(u.clubId);
    if (block) throw new UserError(block);
    await db.update(staff).set({ status: "SUBMITTED", submittedAt: new Date() }).where(eq(staff.id, id));
    await notifyStaff([...REG_ROLES], `طلب قيد إداري — ${u.clubName}`, ex.fullName, "/registration/staff", { clubId: u.clubId });
    await audit(u, "إرسال قيد إداري", "Staff", id);
    return "أُرسل للجنة القيد";
  });
}

export async function deleteStaff(f: FormData) {
  const u = await requireClubUser("club.edit");
  await attempt("/club/staff", async () => {
    const id = int(f, "id")!;
    const [ex] = await db.select().from(staff).where(and(eq(staff.id, id), eq(staff.clubId, u.clubId)));
    if (!ex || ex.status !== "DRAFT") throw new UserError("يمكن حذف المسودات فقط");
    await db.delete(staff).where(eq(staff.id, id));
    return "تم الحذف";
  });
}

/** استيراد لاعبين جدد من ملف Excel — كل صف يصبح لاعبًا وطلب قيد جديد (مسودة) */
export async function importPlayers(f: FormData) {
  const u = await requireClubUser("club.edit");
  await attempt("/club/import", async () => {
    const season = await getCurrentSeason();
    if (!season) throw new UserError("لا يوجد موسم حالي");
    const file = f.get("file") as File | null;
    if (!file || !file.size) throw new UserError("اختر ملف Excel");
    if (file.size > 5 * 1024 * 1024) throw new UserError("الملف أكبر من 5MB");
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await file.arrayBuffer()) as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw new UserError("الملف فارغ");
    const cell = (r: number, c: number) => {
      const v = ws.getRow(r).getCell(c).value as unknown;
      if (v == null) return "";
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      if (typeof v === "object" && v && "text" in v) return String((v as { text: string }).text).trim();
      if (typeof v === "object" && v && "result" in v) return String((v as { result: unknown }).result ?? "").trim();
      return String(v).trim();
    };
    const { POS_MAP, LEVEL_MAP } = await import("@/lib/importCols");
    let created = 0;
    const errors: string[] = [];
    for (let r = 2; r <= Math.min(ws.rowCount, 501); r++) {
      const fullName = cell(r, 1).replace(/\s+/g, " ");
      if (!fullName) continue;
      try {
        const nid = cell(r, 3).replace(/\D/g, "") || null;
        const passport = cell(r, 4) || null;
        const dob = cell(r, 5);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) throw new UserError("تاريخ الميلاد بصيغة YYYY-MM-DD");
        if (nid && nid.length !== 12) throw new UserError("الرقم الوطني 12 رقمًا");
        if (!nid && !passport) throw new UserError("الرقم الوطني أو الجواز مطلوب");
        if (nid) {
          const [ex] = await db.select({ id: players.id }).from(players).where(eq(players.nationalId, nid));
          if (ex) throw new UserError("مسجل مسبقًا — أنشئ له طلب تجديد/انتقال");
        }
        const isForeign = ["نعم", "yes", "1"].includes(cell(r, 8).toLowerCase());
        const cat = await categoryFor(dob, season.startDate);
        const dups = await findDuplicates(fullName, dob);
        await db.transaction(async (tx) => {
          const [pl] = await tx.insert(players).values({
            fullName, fullNameEn: cell(r, 2) || null, nationalId: nid, passportNo: passport, dateOfBirth: dob, placeOfBirth: cell(r, 6) || null,
            nationality: cell(r, 7) || (isForeign ? "" : "ليبي"), isForeign, position: (POS_MAP[cell(r, 9)] ?? "UNKNOWN") as "UNKNOWN",
            professionalLevel: (LEVEL_MAP[cell(r, 10)] ?? "AMATEUR") as "AMATEUR", phone: cell(r, 11) || null, createdByClubId: u.clubId,
          }).returning();
          const [reg] = await tx.insert(registrations).values({
            playerId: pl.id, clubId: u.clubId, seasonId: season.id, type: "NEW", status: "DRAFT", categoryId: cat?.id,
            shirtNumber: Number(cell(r, 12)) || null, possibleDuplicates: dups.length ? dups.map((d) => `#${d.id} ${d.fullName}`).join("، ") : null,
          }).returning();
          await logEvent(tx, reg.id, u.fullName, "استيراد من Excel");
        });
        created++;
      } catch (e) {
        errors.push(`صف ${r} (${fullName}): ${e instanceof UserError ? e.message : "خطأ"}`);
      }
    }
    await audit(u, "استيراد لاعبين من Excel", "Club", u.clubId, { created, errors: errors.length });
    if (!created && errors.length) throw new UserError(errors.slice(0, 5).join(" | "));
    return `تم استيراد ${created} لاعب كمسودات — أكمل لكل لاعب الصورة والمستندات ثم أرسله.${errors.length ? ` تعذّر ${errors.length} صف: ${errors.slice(0, 3).join(" | ")}` : ""}`;
  });
}

/** طلب تأجيل مباراة من النادي */
export async function requestPostpone(f: FormData) {
  const u = await requireClubUser("club.appeals");
  const matchId = int(f, "matchId")!;
  await attempt(`/club/matches/${matchId}`, async () => {
    const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
    if (!m || (m.homeClubId !== u.clubId && m.awayClubId !== u.clubId)) throw new UserError("المباراة غير متاحة");
    if (m.status !== "SCHEDULED") throw new UserError("المباراة ليست مجدولة");
    const [open] = await db.select().from(matchRequests).where(and(eq(matchRequests.matchId, matchId), eq(matchRequests.clubId, u.clubId), eq(matchRequests.status, "PENDING")));
    if (open) throw new UserError("يوجد طلب قيد النظر");
    const doc = f.get("document") as File | null;
    const documentKey = doc && doc.size ? (await saveUpload(doc, `docs/${u.clubId}`)).key : null;
    const pd = str(f, "proposedDate");
    await db.insert(matchRequests).values({ matchId, clubId: u.clubId, reason: req(f, "reason", "السبب"), proposedDate: pd ? new Date(pd + ":00+02:00") : null, documentKey, createdBy: u.fullName });
    await notifyStaff(["COMP_HEAD", "COMP_STAFF"], `طلب تأجيل مباراة — ${u.clubName}`, null, "/competitions/requests", { matchId });
    await audit(u, "طلب تأجيل مباراة", "Match", matchId);
    return "أُرسل طلب التأجيل إلى لجنة المسابقات";
  });
}
