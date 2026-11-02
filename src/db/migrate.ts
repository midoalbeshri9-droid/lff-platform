/* eslint-disable no-console */
// ترحيل البيانات بعد تحديث الجداول: يُشغَّل بعد drizzle-kit push (آمن للتكرار)
import "dotenv/config";
import { sql, eq, inArray } from "drizzle-orm";
import * as s from "./schema";
import { db } from "./index";
import { DEFAULT_PERMISSIONS, ALL_PERMISSIONS } from "../lib/permissions";

export async function migrate() {
  // 1) الحسابات القديمة (قبل نظام التفعيل) تُعتبر مفعّلة
  await db.execute(sql`update users set is_verified = true, verified_at = coalesce(verified_at, now())
    where is_verified = false and not exists (select 1 from user_tokens t where t.user_id = users.id and t.kind = 'VERIFY')`);

  // 2) الصلاحيات الجديدة: تُمنح للأدوار الافتراضية إن لم تكن موجودة في المصفوفة
  const rows = await db.select().from(s.rolePermissions);
  if (rows.length) {
    const known = new Set(rows.map((r) => r.permission));
    const knownRoles = new Set(rows.map((r) => r.role));
    const add: { role: s.Role; permission: string }[] = [];
    for (const [role, ps] of Object.entries(DEFAULT_PERMISSIONS) as [s.Role, string[]][]) {
      for (const p of ps) if (!known.has(p) || !knownRoles.has(role)) add.push({ role, permission: p });
    }
    if (add.length) await db.insert(s.rolePermissions).values(add).onConflictDoNothing();
    if (add.length) console.log(`✓ صلاحيات جديدة: ${add.length}`);
  }
  void ALL_PERMISSIONS;

  // 3) الإعدادات الافتراضية
  const defaults: Record<string, string> = {
    require_origin_consent: "1", appeal_days: "7", block_overdue: "0", block_overdue_min: "0", overdue_days: "30",
    contract_alert_days: "60", sms_enabled: "0",
  };
  for (const [key, value] of Object.entries(defaults)) await db.insert(s.settings).values({ key, value }).onConflictDoNothing();

  // 4) جدول الرسوم الافتراضي (بقيمة صفر حتى تحددها اللجنة المالية)
  const fees: [string, string][] = [
    ["REG_NEW", "رسوم قيد جديد"], ["REG_RENEWAL", "رسوم تجديد قيد"], ["REG_TRANSFER", "رسوم انتقال نهائي"], ["REG_LOAN", "رسوم إعارة"],
    ["REG_LOAN_RETURN", "رسوم عودة من إعارة"], ["CARD_REPLACEMENT", "رسوم بطاقة بديلة"], ["STAFF_REG", "رسوم قيد إداري / جهاز فني"],
  ];
  for (const [code, name] of fees) await db.insert(s.feeTypes).values({ code, name, amount: "0" }).onConflictDoNothing();

  // 5) دمج نوع المراقب: مراقب الحكام ← مراقب المباراة
  await db.update(s.officials).set({ type: "COMMISSIONER" }).where(eq(s.officials.type, "REF_OBSERVER"));
  const dup = await db.select().from(s.assignments).where(inArray(s.assignments.role, ["REF_OBSERVER"]));
  for (const a of dup) {
    const [c] = await db.select().from(s.assignments).where(sql`${s.assignments.matchId} = ${a.matchId} and ${s.assignments.role} = 'COMMISSIONER'`);
    if (!c) await db.update(s.assignments).set({ role: "COMMISSIONER" }).where(eq(s.assignments.id, a.id));
  }
  console.log("✓ اكتمل ترحيل البيانات");
}

if (process.argv[1]?.includes("migrate")) {
  migrate().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
