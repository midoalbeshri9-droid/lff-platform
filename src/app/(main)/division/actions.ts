"use server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clubs, users, officials, stadiums } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { requireDiv, DIV_CREATABLE, grantable, canManageUser } from "@/lib/division";
import { isClubRole, isOfficialRole } from "@/lib/permissions";
import { saveUpload, ALLOWED_IMG } from "@/lib/storage";
import { sendActivation, sendReset, unusableHash } from "@/lib/tokens";
import { ensureUniqueContact } from "@/lib/users";
import { attempt, str, req, int, UserError, reqEmail, reqPhone } from "@/lib/util";
import type { Role } from "@/db/schema";

const q = (d: { id: number; admin: boolean }) => (d.admin ? `?d=${d.id}` : "");
const mailMsg = (sent: boolean) => (sent ? "أُرسل رابط التفعيل إلى بريده" : "تعذر إرسال البريد — تواصل مع إدارة المنظومة لإرسال رابط التفعيل");

// ---------------- أندية الدرجة ----------------
export async function saveDivClub(f: FormData) {
  const u = await requireUser("div.clubs");
  const d = await requireDiv(u, int(f, "d"));
  const id = int(f, "id");
  await attempt(`/division/clubs${q(d)}`, async () => {
    if (id) {
      const [c] = await db.select({ d: clubs.divisionId }).from(clubs).where(eq(clubs.id, id));
      if (!c || c.d !== d.id) throw new UserError("النادي خارج نطاق درجتك");
    }
    const main = int(f, "mainStadiumId"), backup = int(f, "backupStadiumId");
    if (main && main === backup) throw new UserError("الملعب الاحتياطي يجب أن يختلف عن الأساسي (م26)");
    const st = main ? (await db.select({ name: stadiums.name }).from(stadiums).where(eq(stadiums.id, main)))[0] : null;
    const data = {
      name: req(f, "name", "اسم النادي").replace(/\s+/g, " "), nameEn: str(f, "nameEn"), shortName: str(f, "shortName"), code: str(f, "code"),
      city: str(f, "city"), region: str(f, "region"), phone: str(f, "phone"), email: str(f, "email"),
      divisionId: d.id, // النادي يبقى في الدرجة؛ النقل بين الدرجات (الصعود والهبوط) من صلاحية الاتحاد
      ...(f.has("mainStadiumId") ? { mainStadiumId: main, backupStadiumId: backup, stadium: st?.name ?? null } : {}),
    };
    const logo = f.get("logo") as File | null;
    const logoKey = logo && logo.size ? (await saveUpload(logo, "cards", ALLOWED_IMG)).key : undefined;
    if (id) await db.update(clubs).set({ ...data, ...(logoKey ? { logoKey } : {}) }).where(eq(clubs.id, id));
    else await db.insert(clubs).values({ ...data, logoKey, isActive: true });
    await audit(u, id ? "تعديل نادٍ (الدرجة)" : "إضافة نادٍ (الدرجة)", "Club", id, { name: data.name, division: d.name });
    return id ? "تم حفظ النادي" : `أُضيف النادي إلى ${d.name}`;
  });
}

/** تعطيل النادي أو إعادة تفعيله (لا حذف — يبقى تاريخه كاملًا) */
export async function toggleDivClub(f: FormData) {
  const u = await requireUser("div.clubs");
  const d = await requireDiv(u, int(f, "d"));
  const id = int(f, "id")!;
  await attempt(`/division/clubs${q(d)}`, async () => {
    const [c] = await db.select().from(clubs).where(eq(clubs.id, id));
    if (!c || c.divisionId !== d.id) throw new UserError("النادي خارج نطاق درجتك");
    await db.update(clubs).set({ isActive: !c.isActive }).where(eq(clubs.id, id));
    // تعطيل النادي يعطل حساباته أيضًا (ويُسجَّل خروجها)
    if (c.isActive) {
      const us = await db.select().from(users).where(eq(users.clubId, id));
      for (const x of us) await db.update(users).set({ isActive: false, sessionVersion: x.sessionVersion + 1 }).where(eq(users.id, x.id));
    }
    await audit(u, c.isActive ? "تعطيل نادٍ" : "تفعيل نادٍ", "Club", id, c.name);
    return c.isActive ? `عُطّل النادي ${c.name} وحساباته` : `فُعّل النادي ${c.name} — فعّل حساباته من صفحة المستخدمين`;
  });
}

// ---------------- مستخدمو الدرجة ----------------
function permsFrom(f: FormData, u: Awaited<ReturnType<typeof requireUser>>) {
  const allowed = new Set(grantable(u).map((p) => p.k));
  const chosen = f.getAll("perm").map(String).filter((p) => allowed.has(p));
  if (!chosen.length) throw new UserError("حدد صلاحية واحدة على الأقل لموظف الدرجة");
  return chosen;
}

export async function saveDivUser(f: FormData) {
  const u = await requireUser("div.users");
  const d = await requireDiv(u, int(f, "d"));
  const id = int(f, "id");
  await attempt(`/division/users${q(d)}`, async () => {
    const role = req(f, "role", "نوع الحساب") as Role;
    const allowedRoles: Role[] = d.admin ? [...DIV_CREATABLE, "DIV_MANAGER"] : DIV_CREATABLE;
    if (!allowedRoles.includes(role)) throw new UserError("نوع حساب غير مسموح");
    let clubId: number | null = null, officialId: number | null = null;
    if (isClubRole(role)) {
      clubId = int(f, "clubId");
      const [c] = clubId ? await db.select({ d: clubs.divisionId }).from(clubs).where(eq(clubs.id, clubId)) : [];
      if (!c || c.d !== d.id) throw new UserError("اختر ناديًا من أندية الدرجة");
    }
    if (isOfficialRole(role)) {
      officialId = int(f, "officialId");
      const [o] = officialId ? await db.select({ d: officials.divisionId }).from(officials).where(eq(officials.id, officialId)) : [];
      if (!o || o.d !== d.id) throw new UserError("اختر حكمًا/مراقبًا من حكام الدرجة");
      const [ex] = await db.select({ id: users.id }).from(users).where(eq(users.officialId, officialId!));
      if (ex && ex.id !== id) throw new UserError("لهذا الحكم حساب مسبقًا");
    }
    const divisionId = role === "DIV_STAFF" || role === "DIV_MANAGER" ? d.id : null;
    const customPerms = role === "DIV_STAFF" ? permsFrom(f, u) : null;
    const email = reqEmail(f), phone = reqPhone(f);
    await ensureUniqueContact(email, phone, id);
    const data = { fullName: req(f, "fullName", "الاسم"), email, phone, role, clubId, officialId, divisionId, customPerms };
    if (id) {
      const t = await canManageUser(u, d, id);
      if (!t) throw new UserError("لا يمكنك تعديل هذا الحساب");
      await db.update(users).set({ ...data, sessionVersion: t.sessionVersion + (t.role !== role ? 1 : 0) }).where(eq(users.id, id));
      await audit(u, "تعديل حساب (الدرجة)", "User", id, { role, clubId, officialId, perms: customPerms });
      return "تم حفظ الحساب — تسري الصلاحيات فورًا";
    }
    const username = req(f, "username", "اسم المستخدم").toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new UserError("اسم المستخدم: حروف إنجليزية صغيرة وأرقام و . _ -");
    const [n] = await db.insert(users).values({ ...data, username, passwordHash: unusableHash(), isVerified: false }).returning();
    const r = await sendActivation(n);
    await audit(u, "إنشاء حساب (الدرجة)", "User", n.id, { role, clubId, officialId, division: d.name, perms: customPerms });
    return `أُنشئ الحساب ${username} — ${mailMsg(r.sent)}`;
  });
}

export async function divUserAction(f: FormData) {
  const u = await requireUser("div.users");
  const d = await requireDiv(u, int(f, "d"));
  const id = int(f, "id")!;
  const op = str(f, "op");
  await attempt(`/division/users${q(d)}`, async () => {
    const t = await canManageUser(u, d, id);
    if (!t) throw new UserError("لا يمكنك إدارة هذا الحساب");
    if (op === "toggle") {
      if (!t.isActive && t.clubId) {
        const [c] = await db.select({ a: clubs.isActive }).from(clubs).where(eq(clubs.id, t.clubId));
        if (!c?.a) throw new UserError("النادي معطّل — فعّل النادي أولًا");
      }
      await db.update(users).set({ isActive: !t.isActive, sessionVersion: t.sessionVersion + 1 }).where(eq(users.id, id));
      await audit(u, t.isActive ? "تعطيل حساب (الدرجة)" : "تفعيل حساب (الدرجة)", "User", id);
      return t.isActive ? "عُطّل الحساب" : "فُعّل الحساب";
    }
    if (!t.email) throw new UserError("لا يوجد بريد لهذا الحساب");
    if (op === "activation") {
      if (t.isVerified) throw new UserError("الحساب مفعّل مسبقًا");
      const r = await sendActivation(t);
      await audit(u, "إعادة إرسال التفعيل (الدرجة)", "User", id);
      return mailMsg(r.sent);
    }
    if (op === "reset") {
      await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, id));
      const r = await sendReset(t);
      await audit(u, "رابط استعادة كلمة المرور (الدرجة)", "User", id);
      return r.sent ? `أُرسل رابط تعيين كلمة المرور إلى ${t.email}` : "تعذر إرسال البريد — تواصل مع إدارة المنظومة";
    }
    throw new UserError("عملية غير معروفة");
  });
}

