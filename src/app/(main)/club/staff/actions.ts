"use server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { staff, staffDocuments, documentTypes, staffRoleEnum } from "@/db/schema";
import { requireClubUser } from "@/lib/auth";
import { attempt, str, int, req, UserError } from "@/lib/util";
import { audit, notifyStaff } from "@/lib/audit";
import { saveUpload, ALLOWED_IMG } from "@/lib/storage";
import { clubBlockReason } from "@/lib/finance";
import { getCurrentSeason } from "@/lib/registration";
import { LICENSED_ROLES, STAFF_ROLE } from "@/lib/labels";
import { personByNationalId, staffMissing } from "@/lib/staffreg";

const editable = (s: string) => s === "DRAFT" || s === "NEEDS_CORRECTION";
const staffRole = (r: string) => {
  if (!(staffRoleEnum.enumValues as readonly string[]).includes(r)) throw new UserError("الصفة غير صحيحة");
  return r as (typeof staffRoleEnum.enumValues)[number];
};
async function own(id: number, clubId: number) {
  const [s] = await db.select().from(staff).where(and(eq(staff.id, id), eq(staff.clubId, clubId)));
  if (!s) throw new UserError("غير موجود");
  return s;
}

/** إضافة مدرب/إداري: الدور أولًا ثم البيانات — إن كان الرقم الوطني مسجّلًا تُستخدم بياناته (Add Role) */
export async function createStaff(f: FormData) {
  const u = await requireClubUser("club.edit");
  let id = 0;
  await attempt(() => (id ? `/club/staff/${id}` : "/club/staff"), async () => {
    const season = await getCurrentSeason();
    if (!season) throw new UserError("لا يوجد موسم حالي");
    const role = staffRole(req(f, "role", "الصفة"));
    const nid = str(f, "nationalId");
    if (nid) {
      const [dup] = await db.select({ id: staff.id }).from(staff).where(and(eq(staff.clubId, u.clubId), eq(staff.seasonId, season.id), eq(staff.nationalId, nid), eq(staff.role, role)));
      if (dup) { id = dup.id; return "هذا الشخص مسجّل بنفس الصفة هذا الموسم — فُتح ملفه"; }
    }
    const prev = nid ? await personByNationalId(nid) : null;
    const fullName = str(f, "fullName") ?? prev?.fullName;
    if (!fullName) throw new UserError("أدخل الاسم الكامل");
    const [n] = await db.insert(staff).values({
      clubId: u.clubId, seasonId: season.id, role, fullName, nationalId: nid,
      nationality: prev?.nationality ?? "ليبي", dateOfBirth: prev?.dateOfBirth ?? null, phone: prev?.phone ?? null, photoKey: prev?.photoKey ?? null,
      email: prev?.email ?? null, address: prev?.address ?? null,
      ...(LICENSED_ROLES.includes(role) ? { licenseNo: prev?.licenseNo ?? null, licenseLevel: prev?.licenseLevel ?? null, licenseFrom: prev?.licenseFrom ?? null, licenseUntil: prev?.licenseUntil ?? null, level: "AMATEUR" } : {}),
    }).returning();
    id = n.id;
    await audit(u, "إضافة مدرب/إداري", "Staff", id, `${STAFF_ROLE[role]}: ${fullName}`);
    return prev ? `الشخص مسجّل مسبقًا (${prev.source === "player" ? "كلاعب" : "كمدرب/إداري"}) — نُقلت بياناته، راجعها وأكمل الباقي` : "أُنشئ الملف — أكمل البيانات والمستندات ثم أرسله";
  });
}

export async function saveStaff(f: FormData) {
  const u = await requireClubUser("club.edit");
  const id = int(f, "id")!;
  await attempt(`/club/staff/${id}`, async () => {
    const s = await own(id, u.clubId);
    if (!editable(s.status)) throw new UserError("لا يمكن التعديل بعد الإرسال");
    const role = staffRole(req(f, "role", "الصفة"));
    const lic = LICENSED_ROLES.includes(role);
    const photo = f.get("photo") as File | null;
    const photoKey = photo && photo.size ? (await saveUpload(photo, "photos", ALLOWED_IMG)).key : undefined;
    const data = {
      role, fullName: req(f, "fullName", "الاسم"), nationalId: str(f, "nationalId"), nationality: str(f, "nationality") ?? "ليبي",
      dateOfBirth: str(f, "dateOfBirth"), phone: str(f, "phone"), email: str(f, "email"), address: str(f, "address"),
      level: lic ? (f.get("level") === "PROFESSIONAL" ? "PROFESSIONAL" : "AMATEUR") : null,
      licenseNo: lic ? str(f, "licenseNo") : null, licenseLevel: lic ? str(f, "licenseLevel") : null,
      licenseFrom: lic ? str(f, "licenseFrom") : null, licenseUntil: lic ? str(f, "licenseUntil") : null,
    };
    if (data.licenseFrom && data.licenseUntil && data.licenseUntil < data.licenseFrom) throw new UserError("تاريخ انتهاء الرخصة قبل بدايتها");
    await db.update(staff).set({ ...data, ...(photoKey ? { photoKey } : {}) }).where(eq(staff.id, id));
    await audit(u, "تعديل مدرب/إداري", "Staff", id, data.fullName);
    return "تم الحفظ";
  });
}

export async function uploadStaffDoc(f: FormData) {
  const u = await requireClubUser("club.edit");
  const id = int(f, "id")!;
  await attempt(`/club/staff/${id}`, async () => {
    const s = await own(id, u.clubId);
    if (!editable(s.status)) throw new UserError("لا يمكن رفع مستندات بعد الإرسال");
    const typeId = int(f, "documentTypeId");
    const [t] = typeId ? await db.select().from(documentTypes).where(and(eq(documentTypes.id, typeId), eq(documentTypes.scope, "STAFF"))) : [];
    if (!t) throw new UserError("اختر نوع المستند");
    const sv = await saveUpload(f.get("file") as File, `docs/${u.clubId}`);
    await db.insert(staffDocuments).values({ staffId: id, documentTypeId: t.id, fileKey: sv.key, originalName: sv.name, mime: sv.mime, size: sv.size, uploadedBy: u.fullName });
    return `رُفع «${t.name}»`;
  });
}

export async function deleteStaffDoc(f: FormData) {
  const u = await requireClubUser("club.edit");
  const id = int(f, "id")!;
  await attempt(`/club/staff/${id}`, async () => {
    const s = await own(id, u.clubId);
    if (!editable(s.status)) throw new UserError("لا يمكن الحذف بعد الإرسال");
    await db.delete(staffDocuments).where(and(eq(staffDocuments.id, int(f, "docId")!), eq(staffDocuments.staffId, id), eq(staffDocuments.status, "PENDING")));
    return "حُذف المستند";
  });
}

export async function submitStaff(f: FormData) {
  const u = await requireClubUser("club.submit");
  const id = int(f, "id")!;
  await attempt(`/club/staff/${id}`, async () => {
    const s = await own(id, u.clubId);
    if (!editable(s.status)) throw new UserError("غير متاح للإرسال");
    const miss = await staffMissing(s);
    if (miss.length) throw new UserError("ناقص: " + miss.join("، "));
    const block = await clubBlockReason(u.clubId);
    if (block) throw new UserError(block);
    await db.update(staff).set({ status: "SUBMITTED", submittedAt: new Date() }).where(eq(staff.id, id));
    await notifyStaff(["REG_HEAD", "REG_STAFF"], `طلب قيد ${STAFF_ROLE[s.role]} — ${u.clubName}`, s.fullName, `/registration/staff/${id}`, { clubId: u.clubId });
    await audit(u, "إرسال قيد مدرب/إداري", "Staff", id);
    return "أُرسل إلى لجنة القيد";
  });
}

export async function deleteStaff(f: FormData) {
  const u = await requireClubUser("club.edit");
  await attempt("/club/staff", async () => {
    const s = await own(int(f, "id")!, u.clubId);
    if (s.status !== "DRAFT") throw new UserError("يمكن حذف المسودات فقط");
    await db.delete(staff).where(eq(staff.id, s.id));
    return "تم الحذف";
  });
}
