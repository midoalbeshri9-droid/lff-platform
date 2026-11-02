"use server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, rolePermissions, clubs, settings, roleEnum, type Role } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ALL_PERMISSIONS, DEFAULT_PERMISSIONS, isClubRole, isOfficialRole } from "@/lib/permissions";
import { saveUpload, ALLOWED_IMG } from "@/lib/storage";
import { attempt, str, req, int, bool, UserError, reqPhone, reqEmail } from "@/lib/util";
import { sendActivation, sendReset, unusableHash } from "@/lib/tokens";
import { ensureUniqueContact, sentMsg } from "@/lib/users";

export async function saveUser(f: FormData) {
  const u = await requireUser("admin.users");
  const id = int(f, "id");
  await attempt("/admin/users", async () => {
    const role = req(f, "role", "الدور") as Role;
    if (!roleEnum.enumValues.includes(role)) throw new UserError("دور غير صحيح");
    const clubId = isClubRole(role) ? int(f, "clubId") : null;
    if (isClubRole(role) && !clubId) throw new UserError("حساب النادي يجب ربطه بنادٍ");
    const officialId = isOfficialRole(role) ? int(f, "officialId") : null;
    if (isOfficialRole(role) && !officialId) throw new UserError("حساب الحكم/المراقب يجب ربطه بسجله في لجنة الحكام");
    const email = reqEmail(f), phone = reqPhone(f);
    await ensureUniqueContact(email, phone, id);
    const data = { fullName: req(f, "fullName", "الاسم"), phone, email, role, clubId, officialId };
    if (id) {
      if (id === u.id && role !== "ADMIN" && u.role === "ADMIN") throw new UserError("لا يمكنك إزالة صلاحية المدير عن حسابك");
      await db.update(users).set(data).where(eq(users.id, id));
      await audit(u, "تعديل مستخدم", "User", id, { role, clubId, officialId });
      return "تم حفظ المستخدم";
    }
    const username = req(f, "username", "اسم المستخدم").toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new UserError("اسم المستخدم: حروف إنجليزية صغيرة وأرقام و . _ -");
    const [n] = await db.insert(users).values({ ...data, username, passwordHash: unusableHash(), isVerified: false }).returning();
    const r = await sendActivation(n);
    await audit(u, "إنشاء مستخدم", "User", n.id, { role, clubId, officialId, email });
    return `تم إنشاء الحساب — ${sentMsg(r.sent)}`;
  });
}

export async function resendActivation(f: FormData) {
  const u = await requireUser("admin.users");
  const id = int(f, "id")!;
  await attempt("/admin/users", async () => {
    const [t] = await db.select().from(users).where(eq(users.id, id));
    if (t.isVerified) throw new UserError("الحساب مفعّل مسبقًا");
    if (!t.email) throw new UserError("أضف بريدًا للمستخدم أولًا");
    const r = await sendActivation(t);
    await audit(u, "إعادة إرسال التفعيل", "User", id);
    return sentMsg(r.sent);
  });
}

export async function resetPassword(f: FormData) {
  const u = await requireUser("admin.users");
  const id = int(f, "id")!;
  await attempt("/admin/users", async () => {
    const [t] = await db.select().from(users).where(eq(users.id, id));
    if (!t.email) throw new UserError("لا يوجد بريد لهذا المستخدم");
    await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, id));
    const r = await sendReset(t);
    await audit(u, "إرسال رابط استعادة كلمة المرور", "User", id);
    return r.sent ? `أُرسل رابط تعيين كلمة المرور إلى ${t.email}` : "البريد غير مُعدّ — الرابط في «صندوق الرسائل»";
  });
}

export async function toggleUser(f: FormData) {
  const u = await requireUser("admin.users");
  const id = int(f, "id")!;
  await attempt("/admin/users", async () => {
    if (id === u.id) throw new UserError("لا يمكنك تعطيل حسابك");
    const [t] = await db.select().from(users).where(eq(users.id, id));
    await db.update(users).set({ isActive: !t.isActive, sessionVersion: t.sessionVersion + 1 }).where(eq(users.id, id));
    await audit(u, t.isActive ? "تعطيل مستخدم" : "تفعيل مستخدم", "User", id);
    return t.isActive ? "تم التعطيل" : "تم التفعيل";
  });
}

/** حفظ مصفوفة الصلاحيات كاملة */
export async function savePermissions(f: FormData) {
  const u = await requireUser("admin.permissions");
  await attempt("/admin/permissions", async () => {
    const rows: { role: Role; permission: string }[] = [];
    for (const role of roleEnum.enumValues) for (const p of ALL_PERMISSIONS) if (f.get(`${role}:${p}`)) rows.push({ role, permission: p });
    // حماية: مدير المنظومة يحتفظ دائمًا بإدارة المستخدمين والصلاحيات
    for (const p of ["admin.users", "admin.permissions"]) if (!rows.some((r) => r.role === "ADMIN" && r.permission === p)) rows.push({ role: "ADMIN", permission: p });
    await db.transaction(async (tx) => {
      await tx.delete(rolePermissions);
      if (rows.length) await tx.insert(rolePermissions).values(rows);
    });
    await audit(u, "تعديل مصفوفة الصلاحيات", "RolePermission", null, { count: rows.length });
    return "تم حفظ الصلاحيات — تسري فورًا";
  });
}

export async function resetPermissions() {
  const u = await requireUser("admin.permissions");
  await attempt("/admin/permissions", async () => {
    const rows = Object.entries(DEFAULT_PERMISSIONS).flatMap(([role, ps]) => ps.map((permission) => ({ role: role as Role, permission })));
    await db.transaction(async (tx) => {
      await tx.delete(rolePermissions);
      await tx.insert(rolePermissions).values(rows);
    });
    await audit(u, "استعادة الصلاحيات الافتراضية", "RolePermission", null);
    return "تمت استعادة الصلاحيات الافتراضية";
  });
}

export async function saveClub(f: FormData) {
  const u = await requireUser("admin.clubs");
  const id = int(f, "id");
  await attempt("/admin/clubs", async () => {
    const data = {
      name: req(f, "name", "اسم النادي"), nameEn: str(f, "nameEn"), shortName: str(f, "shortName"), code: str(f, "code"),
      city: str(f, "city"), region: str(f, "region"), stadium: str(f, "stadium"), phone: str(f, "phone"), email: str(f, "email"),
      isActive: f.has("isActive") ? bool(f, "isActive") : true,
    };
    const logo = f.get("logo") as File | null;
    const logoKey = logo && logo.size ? (await saveUpload(logo, "cards", ALLOWED_IMG)).key : undefined;
    if (id) await db.update(clubs).set({ ...data, ...(logoKey ? { logoKey } : {}) }).where(eq(clubs.id, id));
    else await db.insert(clubs).values({ ...data, logoKey });
    await audit(u, id ? "تعديل نادٍ" : "إضافة نادٍ", "Club", id, data.name);
    return "تم حفظ النادي";
  });
}

/** إنشاء حساب مدير النادي مباشرة من صفحة الأندية */
export async function createClubManager(f: FormData) {
  const u = await requireUser("admin.users");
  await attempt("/admin/clubs", async () => {
    const clubId = int(f, "clubId")!;
    const username = req(f, "username", "اسم المستخدم").toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new UserError("اسم المستخدم: حروف إنجليزية وأرقام");
    const email = reqEmail(f), phone = reqPhone(f);
    await ensureUniqueContact(email, phone);
    const [c] = await db.select().from(clubs).where(eq(clubs.id, clubId));
    const [n] = await db.insert(users).values({ username, fullName: str(f, "fullName") ?? `مدير حساب ${c.name}`, role: "CLUB_MANAGER", clubId, email, phone, passwordHash: unusableHash(), isVerified: false }).returning();
    const r = await sendActivation(n);
    await audit(u, "إنشاء حساب نادٍ", "User", n.id, { username, club: c.name });
    return `تم إنشاء حساب ${c.name} — ${sentMsg(r.sent)}`;
  });
}

export async function saveSettings(f: FormData) {
  const u = await requireUser("admin.settings");
  await attempt("/admin/settings", async () => {
    for (const k of ["federation_name", "federation_name_en", "sms_enabled"]) {
      const v = str(f, k) ?? "";
      await db.insert(settings).values({ key: k, value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v } });
    }
    await audit(u, "تعديل الإعدادات العامة", "Setting", null);
    return "تم الحفظ";
  });
}

