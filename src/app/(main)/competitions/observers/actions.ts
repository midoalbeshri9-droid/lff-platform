"use server";
import { and, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { officials, users, assignments, matches } from "@/db/schema";
import { guard, inScopeOfficial } from "@/lib/scope";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import bcrypt from "bcryptjs";
import { attempt, str, req, int, UserError, reqEmail, reqPhone, checkPassword } from "@/lib/util";
import { ensureUniqueContact, sentMsg } from "@/lib/users";
import { sendActivation, sendReset, unusableHash } from "@/lib/tokens";

const BACK = "/competitions/observers";

/** مراقبو المباريات المعتمدون لدى لجنة المسابقات — تضيفهم وتعدّلهم وتنشئ حساباتهم */
// رئيس لجنة المسابقات وموظفوها يديرون مراقبي القائمة الاتحادية أيضًا (وإن كان حسابهم مرتبطًا بدرجة)
const FED_ROLES = ["COMP_HEAD", "COMP_STAFF"];
async function canManageObserver(u: { role: string; divisionId: number | null }, divisionId: number | null) {
  return !u.divisionId || divisionId === u.divisionId || (divisionId == null && FED_ROLES.includes(u.role));
}
async function ownObserver(u: Awaited<ReturnType<typeof requireUser>>, id: number) {
  const [o] = await db.select().from(officials).where(eq(officials.id, id));
  if (!o || o.type !== "COMMISSIONER") throw new UserError("ليس مراقب مباراة");
  if (!(await canManageObserver(u, o.divisionId))) guard(await inScopeOfficial(u, id, true));
  return o;
}

export async function saveObserver(f: FormData) {
  const u = await requireUser("comp.observers");
  const id = int(f, "id");
  await attempt(BACK, async () => {
    const old = id ? await ownObserver(u, id) : null;
    const data = {
      fullName: req(f, "fullName", "الاسم"), type: "COMMISSIONER" as const,
      city: str(f, "city"), phone: str(f, "phone"), email: str(f, "email"), licenseNo: str(f, "licenseNo"), licenseExpiry: str(f, "licenseExpiry"), notes: str(f, "notes"),
      // تعديل مراقب اتحادي من حساب مرتبط بدرجة: يبقى في القائمة الاتحادية
      divisionId: u.divisionId ? (old ? old.divisionId : u.divisionId) : int(f, "divisionId"),
    };
    let nid = id;
    if (id) await db.update(officials).set(data).where(eq(officials.id, id));
    else nid = (await db.insert(officials).values(data).returning())[0].id;
    await audit(u, id ? "تعديل مراقب مباراة" : "إضافة مراقب مباراة", "Official", nid, data.fullName);
    return "تم الحفظ";
  });
}

export async function setObserverStatus(f: FormData) {
  const u = await requireUser("comp.observers");
  const id = int(f, "id")!;
  await attempt(BACK, async () => {
    const o = await ownObserver(u, id);
    const status = str(f, "status") as "ACTIVE" | "SUSPENDED" | "RETIRED";
    if (!["ACTIVE", "SUSPENDED", "RETIRED"].includes(status)) throw new UserError("حالة غير صالحة");
    await db.update(officials).set({ status, suspendedUntil: status === "SUSPENDED" ? str(f, "until") : null }).where(eq(officials.id, id));
    // إيقاف المراقب أو اعتزاله: حساب الدخول يتبع الحالة
    await db.update(users).set({ isActive: status === "ACTIVE" }).where(eq(users.officialId, id));
    let warn = "";
    if (status !== "ACTIVE") {
      const up = await db.select({ id: assignments.id }).from(assignments).innerJoin(matches, eq(matches.id, assignments.matchId))
        .where(and(eq(assignments.officialId, id), inArray(assignments.status, ["DRAFT", "APPROVED"]), gte(matches.kickoff, new Date())));
      if (up.length) warn = ` — تنبيه: له ${up.length} تعيين قادم، غيّر المراقب في تلك المباريات`;
    }
    await audit(u, "تغيير حالة مراقب مباراة", "Official", id, { name: o.fullName, status });
    return "تم تحديث الحالة" + warn;
  });
}

export async function observerAccount(f: FormData) {
  const u = await requireUser("comp.observers");
  const id = int(f, "officialId")!;
  await attempt(BACK, async () => {
    const o = await ownObserver(u, id);
    const [ex] = await db.select().from(users).where(eq(users.officialId, id));
    if (f.get("op") === "reset") {
      if (!ex) throw new UserError("لا حساب لهذا المراقب");
      // مراقب بلا بريد: اللجنة تعيّن كلمة مرور مؤقتة يغيّرها عند أول دخول
      if (!ex.email) {
        const pw = str(f, "password") ?? "";
        checkPassword(pw, str(f, "confirm") ?? "");
        await db.update(users).set({ passwordHash: await bcrypt.hash(pw, 10), mustChangePassword: true, isVerified: true, verifiedAt: ex.verifiedAt ?? new Date(), sessionVersion: ex.sessionVersion + 1, failedLogins: 0, lockedUntil: null }).where(eq(users.id, ex.id));
        await audit(u, "تعيين كلمة مرور مؤقتة لمراقب", "User", ex.id, o.fullName);
        return "تم تعيين كلمة المرور المؤقتة — سلّمها للمراقب، وسيُطلب منه تغييرها عند أول دخول";
      }
      const r = ex.isVerified ? await sendReset(ex) : await sendActivation(ex);
      await audit(u, "إرسال رابط دخول لمراقب", "User", ex.id, o.fullName);
      return `تم الإرسال — ${sentMsg(r.sent)}`;
    }
    if (ex) throw new UserError("للمراقب حساب مسبقًا: " + ex.username);
    const username = req(f, "username", "اسم المستخدم").toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new UserError("اسم المستخدم: حروف إنجليزية وأرقام");
    // البريد اختياري للمراقبين: بدونه تفتح اللجنة الحساب بكلمة مرور مؤقتة
    const email = str(f, "email") ? reqEmail(f) : null, phone = reqPhone(f);
    await ensureUniqueContact(email, phone);
    if (!email) {
      const pw = str(f, "password") ?? "";
      if (!pw) throw new UserError("أدخل بريد المراقب، أو كلمة مرور مؤقتة إن لم يكن له بريد");
      checkPassword(pw, str(f, "confirm") ?? "");
      const [n] = await db.insert(users).values({ username, fullName: o.fullName, phone, email: null, role: "OBSERVER", officialId: id, passwordHash: await bcrypt.hash(pw, 10), isVerified: true, verifiedAt: new Date(), mustChangePassword: true }).returning();
      await db.update(officials).set({ phone }).where(eq(officials.id, id));
      await audit(u, "إنشاء حساب مراقب مباراة (بدون بريد)", "User", n.id, { username, official: id });
      return `تم إنشاء الحساب (${username}) — سلّم اسم المستخدم وكلمة المرور المؤقتة للمراقب، وسيُطلب منه تغييرها عند أول دخول`;
    }
    const [n] = await db.insert(users).values({ username, fullName: o.fullName, phone, email, role: "OBSERVER", officialId: id, passwordHash: unusableHash(), isVerified: false }).returning();
    await db.update(officials).set({ email, phone }).where(eq(officials.id, id));
    const r = await sendActivation(n);
    await audit(u, "إنشاء حساب مراقب مباراة", "User", n.id, { username, official: id });
    return `تم إنشاء الحساب (${username}) — ${sentMsg(r.sent)}`;
  });
}
