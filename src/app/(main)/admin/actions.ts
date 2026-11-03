"use server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, rolePermissions, clubs, settings, roleEnum, divisions, type Role } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { ALL_PERMISSIONS, DEFAULT_PERMISSIONS, isClubRole, isOfficialRole, DIVISION_ROLES } from "@/lib/permissions";
import { saveUpload, ALLOWED_IMG } from "@/lib/storage";
import { attempt, str, req, int, bool, UserError, reqPhone, reqEmail } from "@/lib/util";
import { sendActivation, sendReset, unusableHash } from "@/lib/tokens";
import { ensureUniqueContact, sentMsg } from "@/lib/users";
import { testMail } from "@/lib/mail";

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
    // الدرجة: إلزامية لأدوار الدرجة، واختيارية لأدوار الاتحاد (تحصر صلاحياتها في الدرجة)
    const divisionId = isClubRole(role) || isOfficialRole(role) || role === "ADMIN" ? null : int(f, "divisionId");
    if (DIVISION_ROLES.includes(role) && !divisionId) throw new UserError("حدد الدرجة التي يديرها هذا المستخدم");
    const data = { fullName: req(f, "fullName", "الاسم"), phone, email, role, clubId, officialId, divisionId };
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
      divisionId: int(f, "divisionId"),
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


// ---------------- إعدادات البريد (Gmail) ----------------
export async function saveMailSettings(f: FormData) {
  const u = await requireUser("admin.settings");
  await attempt("/admin/mail", async () => {
    const user = (str(f, "smtp_user") ?? "").trim();
    if (user && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user)) throw new UserError("البريد الإلكتروني غير صحيح");
    const vals: Record<string, string> = {
      smtp_host: str(f, "smtp_host") ?? "smtp.gmail.com", smtp_port: String(int(f, "smtp_port") ?? 465), smtp_user: user, mail_from: str(f, "mail_from") ?? "",
    };
    const pass = (str(f, "smtp_pass") ?? "").replace(/\s+/g, "");
    if (pass) vals.smtp_pass = pass; // فارغة = إبقاء كلمة المرور المحفوظة
    if (f.get("clear") === "1") { vals.smtp_pass = ""; vals.smtp_user = ""; }
    for (const [key, value] of Object.entries(vals)) await db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
    await audit(u, "تعديل إعدادات البريد", "Setting", null, { smtp_user: vals.smtp_user, host: vals.smtp_host });
    return f.get("clear") === "1" ? "أُلغي ربط البريد" : "تم حفظ إعدادات البريد — جرّب «إرسال رسالة تجريبية»";
  });
}

export async function sendTestMail(f: FormData) {
  const u = await requireUser("admin.settings");
  await attempt("/admin/mail", async () => {
    const to = reqEmail(f, "to");
    let r: Awaited<ReturnType<typeof testMail>>;
    try { r = await testMail(to); } catch (e) {
      const msg = String((e as Error).message);
      throw new UserError(/Invalid login|BadCredentials|535/i.test(msg) ? "رفض Gmail الدخول: تأكد من البريد ومن «كلمة مرور التطبيق» (16 حرفًا) وأن التحقق بخطوتين مفعّل" : `تعذر الاتصال بخادم البريد: ${msg.slice(0, 160)}`);
    }
    await audit(u, "رسالة بريد تجريبية", "Setting", null, { to, sent: r.sent });
    if (!r.sent) throw new UserError(`لم تُرسل الرسالة: ${"error" in r ? r.error : "تحقق من الإعدادات"}`);
    return `✓ أُرسلت رسالة تجريبية إلى ${to} — تحقق من صندوق الوارد (أو البريد غير الهام)`;
  });
}

// ---------------- الدرجات ----------------
export async function saveDivision(f: FormData) {
  const u = await requireUser("admin.clubs");
  const id = int(f, "id");
  await attempt("/admin/divisions", async () => {
    const data = { name: req(f, "name", "اسم الدرجة"), level: int(f, "level") ?? 1, notes: str(f, "notes"), isActive: f.has("isActive") ? bool(f, "isActive") : true };
    if (id) await db.update(divisions).set(data).where(eq(divisions.id, id));
    else await db.insert(divisions).values(data);
    await audit(u, id ? "تعديل درجة" : "إضافة درجة", "Division", id, data.name);
    return "تم حفظ الدرجة";
  });
}

/** توزيع الأندية على الدرجات (الصعود والهبوط) */
export async function saveClubDivisions(f: FormData) {
  const u = await requireUser("admin.clubs");
  await attempt("/admin/divisions", async () => {
    let n = 0;
    const moves: string[] = [];
    const all = await db.select({ id: clubs.id, name: clubs.name, d: clubs.divisionId, r: clubs.region }).from(clubs);
    const divs = await db.select().from(divisions);
    let nr = 0;
    for (const c of all) {
      if (f.has(`r_${c.id}`)) {
        const r = str(f, `r_${c.id}`) ?? null;
        if (r !== (c.r ?? null)) { await db.update(clubs).set({ region: r }).where(eq(clubs.id, c.id)); moves.push(`${c.name}: المنطقة ${c.r ?? "—"} ← ${r ?? "—"}`); nr++; }
      }
      if (!f.has(`d_${c.id}`)) continue;
      const d = int(f, `d_${c.id}`);
      if ((d ?? null) === (c.d ?? null)) continue;
      await db.update(clubs).set({ divisionId: d }).where(eq(clubs.id, c.id));
      moves.push(`${c.name}: ${divs.find((x) => x.id === c.d)?.name ?? "—"} ← ${divs.find((x) => x.id === d)?.name ?? "—"}`);
      n++;
    }
    await audit(u, "توزيع الأندية على الدرجات", "Division", null, moves);
    return n || nr ? [n && `نُقل ${n} نادٍ بين الدرجات`, nr && `عُدّلت منطقة ${nr} نادٍ`].filter(Boolean).join(" — ") : "لا تغييرات";
  });
}
