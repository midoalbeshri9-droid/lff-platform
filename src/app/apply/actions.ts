"use server";
import { and, eq, gte, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { db } from "@/db";
import { selfApplications, clubs } from "@/db/schema";
import { saveUpload, ALLOWED_IMG, ALLOWED_DOC } from "@/lib/storage";
import { notifyClub, notifyRoles } from "@/lib/audit";
import { str, req, reqPhone, UserError } from "@/lib/util";
import { SELF_OFFICIAL_TYPES } from "@/lib/labels";
import { getSetting } from "@/lib/registration";

/** تقديم طلب تسجيل ذاتي من الصفحة العامة (بدون حساب) — محمي بحقل مخفي وحدّ لعدد الطلبات من نفس الجهاز */
export async function submitSelfApplication(f: FormData) {
  const kind = str(f, "kind") === "OFFICIAL" ? "OFFICIAL" : "PLAYER";
  const back = `/apply?kind=${kind === "OFFICIAL" ? "official" : "player"}`;
  let ref = "";
  try {
    if ((await getSetting("self_apply", "1")) !== "1") throw new UserError("التسجيل الذاتي متوقف حاليًا");
    if (str(f, "website")) throw new UserError("تعذّر إرسال الطلب"); // حقل فخ للروبوتات
    const ip = ((await headers()).get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
    if (ip) {
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(selfApplications)
        .where(and(eq(selfApplications.ip, ip), gte(selfApplications.createdAt, new Date(Date.now() - 3600_000))));
      if (n >= 5) throw new UserError("عدد كبير من الطلبات من هذا الجهاز — حاول بعد ساعة");
    }
    const nid = str(f, "nationalId");
    if (nid && !/^[0-9]{12}$/.test(nid)) throw new UserError("الرقم الوطني يجب أن يكون 12 رقمًا");
    if (!nid && !str(f, "passportNo")) throw new UserError("أدخل الرقم الوطني أو رقم الجواز");
    if (!f.get("consent")) throw new UserError("يجب الموافقة على استخدام البيانات لأغراض القيد");
    const dob = req(f, "dateOfBirth", "تاريخ الميلاد");
    const age = (Date.now() - new Date(dob).getTime()) / (365.25 * 864e5);
    if (!(age >= 5 && age <= 70)) throw new UserError("تاريخ الميلاد غير صحيح");
    let clubId: number | null = null, officialType: string | null = null;
    if (kind === "PLAYER") {
      clubId = Number(str(f, "clubId")) || null;
      if (!clubId) throw new UserError("اختر النادي الذي تريد التسجيل فيه");
      const [c] = await db.select({ id: clubs.id }).from(clubs).where(and(eq(clubs.id, clubId), eq(clubs.isActive, true)));
      if (!c) throw new UserError("النادي غير موجود");
      if (age < 18 && !str(f, "guardian")) throw new UserError("للقاصر: أدخل اسم وليّ الأمر الموافق");
    } else {
      officialType = str(f, "officialType");
      if (!officialType || !(SELF_OFFICIAL_TYPES as readonly string[]).includes(officialType)) throw new UserError("اختر الصفة");
      if (age < 16) throw new UserError("الحد الأدنى للسن 16 سنة");
    }
    if (nid) {
      const [open] = await db.select({ id: selfApplications.id }).from(selfApplications)
        .where(and(eq(selfApplications.nationalId, nid), eq(selfApplications.kind, kind), eq(selfApplications.status, "NEW")));
      if (open) throw new UserError("يوجد طلب سابق بهذا الرقم الوطني قيد المراجعة");
    }
    const photo = f.get("photo") as File | null;
    if (!photo || !photo.size) throw new UserError("الصورة الشخصية مطلوبة");
    const ph = await saveUpload(photo, "self-apply", ALLOWED_IMG, 5 * 1024 * 1024);
    const idf = f.get("idDoc") as File | null;
    const idk = idf && idf.size ? (await saveUpload(idf, "self-apply", ALLOWED_DOC, 8 * 1024 * 1024)).key : null;
    ref = "SA-" + randomBytes(4).toString("hex").toUpperCase();
    const guardian = str(f, "guardian");
    const notes = [str(f, "experience"), guardian ? `وليّ الأمر: ${guardian}` : null].filter(Boolean).join(" — ") || null;
    await db.insert(selfApplications).values({
      kind, refNo: ref, ip,
      fullName: req(f, "fullName", "الاسم الرباعي").replace(/\s+/g, " "), fullNameEn: str(f, "fullNameEn"), motherName: str(f, "motherName"),
      dateOfBirth: dob, placeOfBirth: str(f, "placeOfBirth"), gender: str(f, "gender") === "FEMALE" ? "FEMALE" : "MALE",
      nationality: str(f, "nationality") ?? "ليبي", nationalId: nid, passportNo: str(f, "passportNo"),
      phone: reqPhone(f), email: str(f, "email")?.toLowerCase() ?? null, city: str(f, "city"), address: str(f, "address"),
      clubId, position: str(f, "position"), officialType, experience: notes,
      photoKey: ph.key, photoHash: ph.hash, idDocKey: idk,
    });
    if (clubId) await notifyClub(clubId, "طلب تسجيل ذاتي من لاعب", `${str(f, "fullName")} — راجع الطلب واعتمده لإنشاء طلب القيد`, "/club/applications");
    else await notifyRoles(["REF_HEAD"], "طلب تسجيل ذاتي (حكام)", str(f, "fullName"), "/referees/applications");
  } catch (e) {
    const m = e instanceof UserError ? e.message : "تعذّر إرسال الطلب، حاول مرة أخرى";
    if (!(e instanceof UserError)) console.error(e);
    redirect(`${back}&err=${encodeURIComponent(m)}`);
  }
  redirect(`/apply/done?ref=${ref}`);
}
