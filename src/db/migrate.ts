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
  // 6) مراحل المسابقات: كل مسابقة قديمة تصبح مرحلة واحدة بنظامها، وتُربط بها فرقها ومبارياتها
  const comps = await db.select().from(s.competitions);
  for (const c of comps) {
    const [has] = await db.select({ id: s.competitionStages.id }).from(s.competitionStages).where(eq(s.competitionStages.competitionId, c.id)).limit(1);
    if (has) continue;
    const format = c.type === "CUP" ? "KNOCKOUT" : c.type === "LEAGUE" ? "LEAGUE" : "GROUPS";
    const name = format === "KNOCKOUT" ? "خروج المغلوب" : format === "GROUPS" ? "دور المجموعات" : "الدوري";
    const [st] = await db.insert(s.competitionStages).values({ competitionId: c.id, seq: 1, name, format, legs: format === "KNOCKOUT" ? 1 : c.legs, status: c.status === "FINISHED" ? "DONE" : "ACTIVE" }).returning();
    if (c.type === "GROUPS_KNOCKOUT") await db.insert(s.competitionStages).values({ competitionId: c.id, seq: 2, name: "الأدوار الإقصائية", format: "KNOCKOUT", legs: 1 });
    const teams = await db.select().from(s.competitionTeams).where(eq(s.competitionTeams.competitionId, c.id));
    if (teams.length) await db.insert(s.stageTeams).values(teams.map((t) => ({ stageId: st.id, clubId: t.clubId, groupName: t.groupName }))).onConflictDoNothing();
    await db.update(s.matches).set({ stageId: st.id }).where(sql`${s.matches.competitionId} = ${c.id} and ${s.matches.stageId} is null`);
    if (format === "KNOCKOUT") await db.update(s.matches).set({ tieNo: sql`${s.matches.id}`, leg: 1 }).where(sql`${s.matches.stageId} = ${st.id} and ${s.matches.tieNo} is null`);
  }

  // 7) تطبيق لائحة تنظيم المسابقات (2018) على المسابقات القائمة — مرة واحدة
  const [applied] = await db.select().from(s.settings).where(eq(s.settings.key, "lff_comp_reg_2018"));
  if (!applied) {
    await db.update(s.competitions).set({ tiebreak: "LFF" }).where(sql`${s.competitions.tiebreak} = 'GD'`);
    await db.update(s.competitions).set({ squadMax: 18 }).where(sql`${s.competitions.squadMax} = 20`);
    await db.insert(s.settings).values({ key: "lff_comp_reg_2018", value: new Date().toISOString() }).onConflictDoNothing();
  }

  // 8) سجل الملاعب: يُنشأ من ملاعب الأندية المسجلة، وتُربط المباريات بها بالاسم
  const clubRows = await db.select().from(s.clubs);
  for (const c of clubRows) {
    if (!c.stadium?.trim()) continue;
    await db.insert(s.stadiums).values({ name: c.stadium.trim(), city: c.city, clubId: c.id }).onConflictDoNothing();
  }
  await db.execute(sql`update "matches" set "stadium_id" = "stadiums"."id" from "stadiums" where "matches"."stadium_id" is null and trim("matches"."venue") = "stadiums"."name"`);
  // م26: الملعب الأساسي للنادي من الاسم المسجل سابقًا
  await db.execute(sql`update "clubs" set "main_stadium_id" = "stadiums"."id" from "stadiums" where "clubs"."main_stadium_id" is null and trim("clubs"."stadium") = "stadiums"."name"`);
  await db.insert(s.settings).values({ key: "min_rest_hours", value: "48" }).onConflictDoNothing();

  // 9) إعدادات البريد الافتراضية (فارغة حتى يضبطها المدير)
  await db.insert(s.settings).values({ key: "smtp_port", value: "465" }).onConflictDoNothing();
  // 10) درجات الدوري الافتراضية (تُنشأ مرة واحدة فقط — لا تُسند الأندية تلقائيًا)
  const [hasDiv] = await db.select({ id: s.divisions.id }).from(s.divisions).limit(1);
  if (!hasDiv) await db.insert(s.divisions).values([
    { name: "الدوري الممتاز", level: 1 }, { name: "الدرجة الأولى", level: 2 }, { name: "الدرجة الثانية", level: 3 }, { name: "الدرجة الثالثة", level: 4 },
  ]).onConflictDoNothing();
  // 11) نوع مستند عام لملف اللاعب (لا يُطلب إلزاميًا)
  await db.insert(s.documentTypes).values({ name: "مستند آخر", requiredFor: [], sortOrder: 99 }).onConflictDoNothing();
  // 12) مدير الدرجة يضيف الملاعب (مرة واحدة)
  const [st12] = await db.select().from(s.settings).where(eq(s.settings.key, "mig_div_stadiums"));
  if (!st12) {
    await db.insert(s.rolePermissions).values({ role: "DIV_MANAGER", permission: "comp.stadiums" }).onConflictDoNothing();
    await db.insert(s.settings).values({ key: "mig_div_stadiums", value: new Date().toISOString() }).onConflictDoNothing();
  }
  // 13) مدير الدرجة يفتح فترات القيد لدرجته (مرة واحدة)
  const [st13] = await db.select().from(s.settings).where(eq(s.settings.key, "mig_div_windows"));
  if (!st13) {
    await db.insert(s.rolePermissions).values({ role: "DIV_MANAGER", permission: "reg.windows" }).onConflictDoNothing();
    await db.insert(s.settings).values({ key: "mig_div_windows", value: new Date().toISOString() }).onConflictDoNothing();
  }
  // 14) القيود المستوردة كان رقم قيدها = رقم البطاقة: تُعطى أرقام قيد بصيغة المنظومة (رقم البطاقة يبقى في ملف اللاعب)
  const imported = await db.select({ id: s.registrations.id, season: s.seasons.name }).from(s.registrations)
    .innerJoin(s.players, eq(s.players.id, s.registrations.playerId)).innerJoin(s.seasons, eq(s.seasons.id, s.registrations.seasonId))
    .where(sql`${s.registrations.number} is not null and ${s.registrations.number} = ${s.players.cardNo}`).orderBy(s.registrations.id);
  for (const r of imported) {
    const [row] = await db.insert(s.counters).values({ key: `reg:${r.season}`, value: 1 })
      .onConflictDoUpdate({ target: s.counters.key, set: { value: sql`${s.counters.value} + 1` } }).returning();
    await db.update(s.registrations).set({ number: `${r.season.slice(0, 4)}-${String(row.value).padStart(5, "0")}` }).where(eq(s.registrations.id, r.id));
  }
  if (imported.length) console.log(`✓ أرقام قيد جديدة لـ ${imported.length} قيدًا مستوردًا`);
  // 15) حقل «رقم البطاقة» في قوالب البطاقات ذات التصميم الافتراضي (تحت الموسم)
  for (const t of await db.select().from(s.cardTemplates)) {
    if (t.front.some((e) => e.field === "cardNo")) continue;
    const season = t.front.find((e) => e.id === "season" && e.y === 38.5 && e.x === 40);
    if (!season) continue; // قالب معدّل: يُضاف الحقل من مصمم البطاقات
    await db.update(s.cardTemplates).set({ front: [...t.front, { id: "cardNo", kind: "field", field: "cardNo", text: "رقم البطاقة:", x: 40, y: 43, w: 43, h: 4, fontSize: 7.5, align: "right" }] }).where(eq(s.cardTemplates.id, t.id));
  }
  // 16) الاطلاع على تقارير الحكام والمراقبين (سرية للجنة المسابقات) — مرة واحدة
  const [st16] = await db.select().from(s.settings).where(eq(s.settings.key, "mig_reports_view"));
  if (!st16) {
    for (const role of ["COMP_HEAD", "COMP_STAFF", "DIV_MANAGER"] as const) await db.insert(s.rolePermissions).values({ role, permission: "comp.reports.view" }).onConflictDoNothing();
    await db.insert(s.settings).values({ key: "mig_reports_view", value: new Date().toISOString() }).onConflictDoNothing();
  }
  // 17) إدارة مراقبي المباريات وحساباتهم: لرئيس لجنة المسابقات وموظفيها — مرة واحدة
  const [st17] = await db.select().from(s.settings).where(eq(s.settings.key, "mig_observers_perm"));
  if (!st17) {
    for (const role of ["COMP_HEAD", "COMP_STAFF"] as const) await db.insert(s.rolePermissions).values({ role, permission: "comp.observers" }).onConflictDoNothing();
    await db.insert(s.settings).values({ key: "mig_observers_perm", value: new Date().toISOString() }).onConflictDoNothing();
  }
  // 18) مستندات المدربين والإداريين الافتراضية (كما في FIFA Connect) — مرة واحدة، وتعدّلها لجنة القيد من الإعدادات
  const [st18] = await db.select().from(s.settings).where(eq(s.settings.key, "mig_staff_docs"));
  if (!st18) {
    const docs: { name: string; requiredFor: string[]; onlyProfessional?: boolean; onlyForeign?: boolean; sortOrder: number }[] = [
      { name: "صورة الهوية أو جواز السفر", requiredFor: ["COACH", "OFFICIAL"], sortOrder: 1 },
      { name: "شهادة الرخصة التدريبية", requiredFor: ["COACH"], sortOrder: 2 },
      { name: "عقد المدرب", requiredFor: ["COACH"], onlyProfessional: true, sortOrder: 3 },
      { name: "قرار التكليف من النادي", requiredFor: ["OFFICIAL"], sortOrder: 4 },
      { name: "تصريح العمل / الإقامة", requiredFor: [], onlyForeign: true, sortOrder: 5 },
    ];
    for (const d of docs) await db.insert(s.documentTypes).values({ ...d, scope: "STAFF" }).onConflictDoNothing();
    await db.insert(s.settings).values({ key: "mig_staff_docs", value: new Date().toISOString() }).onConflictDoNothing();
    console.log("✓ مستندات المدربين والإداريين");
  }
  console.log("✓ اكتمل ترحيل البيانات");
}

if (process.argv[1]?.includes("migrate")) {
  migrate().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
