/* eslint-disable no-console */
// تهيئة قاعدة البيانات: npm run db:seed   — ومع بيانات تجريبية: SEED_DEMO=1 npm run db:seed
import "dotenv/config";
import bcrypt from "bcryptjs";
import { promises as fs } from "fs";
import path from "path";
import { sql, eq } from "drizzle-orm";
import * as s from "./schema";
import { db } from "./index";
import { DEFAULT_PERMISSIONS } from "../lib/permissions";
import { DEFAULT_FRONT } from "../lib/cardDefault";
import { roundRobin } from "../lib/competitionPure";
import { migrate } from "./migrate";

const hash = (p: string) => bcrypt.hashSync(p, 10);

async function base() {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(s.users);
  if (n > 0) {
    console.log("قاعدة البيانات مُهيأة مسبقًا — تخطي البيانات الأساسية");
    return false;
  }
  await db.insert(s.settings).values([
    { key: "federation_name", value: "الاتحاد الليبي لكرة القدم" },
    { key: "federation_name_en", value: "Libyan Football Federation" },
    { key: "require_origin_consent", value: "1" },
  ]);
  await db.insert(s.rolePermissions).values(Object.entries(DEFAULT_PERMISSIONS).flatMap(([role, ps]) => ps.map((permission) => ({ role: role as s.Role, permission }))));
  await db.insert(s.ageCategories).values([
    { name: "الفريق الأول", maxAge: null, sortOrder: 1 },
    { name: "تحت 23 سنة (الأولمبي)", maxAge: 23, sortOrder: 2 },
    { name: "تحت 20 سنة (الأواسط)", maxAge: 20, sortOrder: 3 },
    { name: "تحت 17 سنة (الناشئين)", maxAge: 17, sortOrder: 4 },
    { name: "تحت 15 سنة (الأشبال)", maxAge: 15, sortOrder: 5 },
    { name: "تحت 13 سنة (البراعم)", maxAge: 13, sortOrder: 6 },
  ]);
  const ALL: s.RegType[] = ["NEW", "RENEWAL", "TRANSFER", "LOAN", "LOAN_RETURN"];
  await db.insert(s.documentTypes).values([
    { name: "صورة الهوية / الرقم الوطني", requiredFor: ["NEW"], sortOrder: 1 },
    { name: "شهادة الميلاد", requiredFor: ["NEW"], sortOrder: 2 },
    { name: "جواز السفر", requiredFor: ["NEW", "TRANSFER", "LOAN"], onlyForeign: true, sortOrder: 3 },
    { name: "الكشف الطبي", requiredFor: ALL, sortOrder: 4 },
    { name: "عقد اللاعب", requiredFor: ["NEW", "RENEWAL", "TRANSFER"], onlyProfessional: true, sortOrder: 5 },
    { name: "عقد الإعارة", requiredFor: ["LOAN"], sortOrder: 6 },
    { name: "استمارة القيد موقعة", requiredFor: ALL, sortOrder: 7 },
    { name: "موافقة ولي الأمر", requiredFor: ["NEW", "TRANSFER", "LOAN"], onlyMinor: true, sortOrder: 8 },
    { name: "شهادة الانتقال الدولية (ITC)", requiredFor: [], onlyForeign: true, sortOrder: 9 },
    { name: "مخالصة النادي السابق", requiredFor: ["TRANSFER"], sortOrder: 10 },
    { name: "مستند آخر", requiredFor: [], sortOrder: 99 },
  ]);
  const y = new Date().getMonth() >= 6 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  const [season] = await db.insert(s.seasons).values([
    { name: `${y}-${y + 1}`, startDate: `${y}-08-01`, endDate: `${y + 1}-07-31`, isCurrent: true },
  ]).returning();
  const today = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + 45 * 864e5).toISOString().slice(0, 10);
  await db.insert(s.registrationWindows).values({ seasonId: season.id, label: "الفترة الشتوية", startDate: today, endDate: end });
  await db.insert(s.cardTemplates).values({ name: "بطاقة قيد لاعب — CR80", front: DEFAULT_FRONT, isDefault: true });
  await db.insert(s.listTemplates).values([
    { name: "القائمة الرسمية للمسابقات", columns: ["seq", "photo", "number", "fullName", "dob", "nationalId", "category", "position", "shirt", "signature"], options: { title: "كشف اللاعبين المقيدين", showStamp: true, signatures: ["رئيس لجنة القيد وأوضاع اللاعبين", "الأمين العام"] } },
    { name: "قائمة مختصرة", columns: ["seq", "number", "fullName", "birthYear", "category"], options: { title: "قائمة اللاعبين" } },
  ]);
  const pw = process.env.SEED_ADMIN_PASSWORD || "Admin@12345";
  await db.insert(s.users).values({ username: "admin", fullName: "مدير المنظومة", role: "ADMIN", passwordHash: hash(pw), mustChangePassword: true, isVerified: true, verifiedAt: new Date() });
  console.log(`✓ البيانات الأساسية — المستخدم: admin  كلمة المرور: ${pw}`);
  return true;
}

// ---------------------- بيانات تجريبية ----------------------
const CLUBS: [string, string, string, string][] = [
  ["الأهلي طرابلس", "Al Ahli Tripoli", "طرابلس", "ملعب طرابلس الدولي"],
  ["الاتحاد", "Al Ittihad", "طرابلس", "ملعب طرابلس الدولي"],
  ["الأهلي بنغازي", "Al Ahli Benghazi", "بنغازي", "ملعب بنينا"],
  ["النصر", "Al Nasr", "بنغازي", "ملعب 28 مارس"],
  ["الهلال", "Al Hilal", "بنغازي", "ملعب 28 مارس"],
  ["السويحلي", "Al Swehly", "مصراتة", "الملعب البلدي مصراتة"],
  ["المدينة", "Al Madina", "طرابلس", "ملعب أبوسليم"],
  ["الأخضر", "Al Akhdar", "البيضاء", "ملعب البيضاء"],
];
const FIRST = ["محمد", "أحمد", "علي", "عمر", "خالد", "يوسف", "إبراهيم", "عبدالله", "مصطفى", "حسام", "أنس", "معاذ", "سالم", "طارق", "مهند", "أيمن", "صلاح", "وليد", "فرج", "ناصر"];
const FAM = ["الورفلي", "الترهوني", "المصراتي", "الزنتاني", "البرعصي", "العبيدي", "الفيتوري", "القماطي", "الشريف", "المغربي", "الككلي", "السنوسي", "بن عامر", "الحاسي", "المسماري"];
const POS = ["GOALKEEPER", "DEFENDER", "DEFENDER", "DEFENDER", "MIDFIELDER", "MIDFIELDER", "MIDFIELDER", "FORWARD", "FORWARD"] as const;

async function demoPhoto() {
  // صورة رمزية بسيطة (SVG→PNG غير متاح) — نستخدم PNG صغير مولّد مسبقًا من الشعار كصورة مؤقتة
  const dir = path.resolve(process.env.STORAGE_DIR ?? "./storage", "photos/demo");
  await fs.mkdir(dir, { recursive: true });
  const src = path.resolve("public/img/avatar-demo.png");
  const key = "photos/demo/avatar.png";
  try { await fs.copyFile(src, path.join(dir, "avatar.png")); return key; } catch { return null; }
}

async function demo() {
  const [season] = await db.select().from(s.seasons).where(eq(s.seasons.isCurrent, true));
  const cats = await db.select().from(s.ageCategories);
  const senior = cats.find((c) => c.maxAge == null)!;
  const u20 = cats.find((c) => c.maxAge === 20)!;
  const clubs = await db.insert(s.clubs).values(CLUBS.map(([name, nameEn, city, stadium], i) => ({ name, nameEn, city, stadium, code: `C${String(i + 1).padStart(2, "0")}` }))).returning();
  const photo = process.env.STORAGE_DRIVER === "s3" ? null : await demoPhoto();
  const pw = hash("Test@12345");
  // مستخدمو اللجان
  const V = { isVerified: true, verifiedAt: new Date(), mustChangePassword: false };
  const demoUsers: [string, string, s.Role][] = [
    ["president", "رئيس الاتحاد", "PRESIDENT"], ["reg.head", "رئيس لجنة القيد", "REG_HEAD"], ["reg.staff", "موظف لجنة القيد", "REG_STAFF"],
    ["comp.head", "رئيس لجنة المسابقات", "COMP_HEAD"], ["ref.head", "رئيس لجنة الحكام", "REF_HEAD"], ["fin.head", "رئيس اللجنة المالية", "FIN_HEAD"], ["fin.staff", "موظف اللجنة المالية", "FIN_STAFF"],
  ];
  await db.insert(s.users).values(demoUsers.map(([username, fullName, role], i) => ({ username, fullName, role, passwordHash: pw, email: `${username.replace(".", "_")}@lff-demo.ly`, phone: `09100000${String(i + 10)}`, ...V })));
  // حساب لكل نادٍ
  await db.insert(s.users).values(clubs.map((c, i) => ({ username: `club${i + 1}`, fullName: `مدير حساب ${c.name}`, role: "CLUB_MANAGER" as const, clubId: c.id, passwordHash: pw, email: `club${i + 1}@lff-demo.ly`, phone: `09200000${String(i + 10)}`, ...V })));

  // لاعبون: 18 لكل نادٍ في الفريق الأول + 4 أواسط
  let seq = 0;
  const rnd = (a: number, b: number) => a + Math.floor(((seq * 9301 + 49297) % 233280) / 233280 * (b - a + 1));
  let num = 0;
  for (const c of clubs) {
    for (let i = 0; i < 22; i++) {
      seq++;
      const young = i >= 18;
      const yr = young ? 2007 + (i % 2) : 1993 + rnd(0, 10);
      const dob = `${yr}-${String(1 + (seq % 12)).padStart(2, "0")}-${String(1 + (seq % 27)).padStart(2, "0")}`;
      const foreign = i === 17 && seq % 2 === 0;
      const [p] = await db.insert(s.players).values({
        fullName: `${FIRST[seq % FIRST.length]} ${FIRST[(seq * 7) % FIRST.length]} ${FIRST[(seq * 3) % FIRST.length]} ${FAM[seq % FAM.length]}`,
        nationalId: foreign ? null : `1${yr}${String(seq).padStart(7, "0")}`, passportNo: foreign ? `P${String(seq).padStart(7, "0")}` : null,
        dateOfBirth: dob, nationality: foreign ? "تونسي" : "ليبي", isForeign: foreign, position: POS[i % POS.length],
        professionalLevel: young ? "AMATEUR" : i % 3 === 0 ? "PROFESSIONAL" : "AMATEUR_CONTRACT", photoKey: photo, city: c.city, createdByClubId: c.id,
      }).returning();
      const status = i === 16 ? "SUBMITTED" : i === 15 && c.id % 2 === 0 ? "NEEDS_CORRECTION" : "APPROVED";
      num++;
      const [r] = await db.insert(s.registrations).values({
        playerId: p.id, clubId: c.id, seasonId: season.id, type: "NEW", status, categoryId: young ? u20.id : senior.id,
        shirtNumber: i + 1, number: status === "APPROVED" ? `${season.name.slice(0, 4)}-${String(num).padStart(5, "0")}` : null,
        submittedAt: new Date(), submittedBy: `مدير حساب ${c.name}`, decidedAt: status === "APPROVED" ? new Date() : null, decidedBy: status === "APPROVED" ? "رئيس لجنة القيد" : null,
        decisionReason: status === "NEEDS_CORRECTION" ? "الكشف الطبي غير واضح — يرجى رفع نسخة أوضح" : null,
      }).returning();
      await db.insert(s.registrationEvents).values({ registrationId: r.id, userName: `مدير حساب ${c.name}`, action: "إرسال إلى لجنة القيد" });
      if (status === "APPROVED") await db.insert(s.registrationEvents).values({ registrationId: r.id, userName: "رئيس لجنة القيد", action: "اعتماد القيد", note: r.number });
    }
  }
  await db.insert(s.counters).values({ key: `reg:${season.name}`, value: num });

  // حكام ومراقبون
  const offs = await db.insert(s.officials).values([
    { fullName: "عبدالباسط الفيتوري", type: "REFEREE", grade: "INTERNATIONAL", city: "طرابلس", fitness: "PASSED", licenseExpiry: "2027-12-31" },
    { fullName: "معتز الشلماني", type: "REFEREE", grade: "FIRST", city: "بنغازي", fitness: "PASSED", licenseExpiry: "2027-12-31" },
    { fullName: "نادر القماطي", type: "REFEREE", grade: "FIRST", city: "مصراتة", fitness: "PASSED", licenseExpiry: "2027-12-31" },
    { fullName: "هشام الككلي", type: "ASSISTANT", grade: "FIRST", city: "سبها", fitness: "PASSED" },
    { fullName: "سفيان البرعصي", type: "ASSISTANT", grade: "SECOND", city: "الزاوية", fitness: "PASSED" },
    { fullName: "أكرم الزنتاني", type: "ASSISTANT", grade: "SECOND", city: "غريان", fitness: "FAILED" },
    { fullName: "رمضان السنوسي", type: "COMMISSIONER", grade: "INTERNATIONAL", city: "طرابلس" },
    { fullName: "فتحي المسماري", type: "COMMISSIONER", grade: "FIRST", city: "بنغازي" },
  ]).returning();
  await db.insert(s.users).values([
    { username: "referee1", fullName: offs[0].fullName, role: "REFEREE", officialId: offs[0].id, passwordHash: pw, email: "referee1@lff-demo.ly", phone: "0930000011", ...V },
    { username: "observer1", fullName: offs[6].fullName, role: "OBSERVER", officialId: offs[6].id, passwordHash: pw, email: "observer1@lff-demo.ly", phone: "0930000012", ...V },
    { username: "commissioner1", fullName: offs[7].fullName, role: "OBSERVER", officialId: offs[7].id, passwordHash: pw, email: "commissioner1@lff-demo.ly", phone: "0930000013", ...V },
  ]);
  // رسوم وأجور تجريبية
  await migrate();
  for (const [code, amount, pro] of [["REG_NEW", "100", "500"], ["REG_RENEWAL", "50", "300"], ["REG_TRANSFER", "200", "1000"], ["REG_LOAN", "150", "600"], ["CARD_REPLACEMENT", "25", null], ["STAFF_REG", "50", null]] as const)
    await db.update(s.feeTypes).set({ amount, amountPro: pro }).where(eq(s.feeTypes.code, code));
  await db.insert(s.refereeRates).values([
    { role: "REFEREE", amount: "400" }, { role: "AR1", amount: "250" }, { role: "AR2", amount: "250" }, { role: "FOURTH", amount: "150" }, { role: "VAR", amount: "300" },
    { role: "COMMISSIONER", amount: "300" }, { role: "REFEREE", grade: "INTERNATIONAL", amount: "600" },
  ]).onConflictDoNothing();
  // عقود للاعبين المحترفين المعتمدين
  const pros = await db.select({ r: s.registrations, p: s.players }).from(s.registrations).innerJoin(s.players, eq(s.players.id, s.registrations.playerId))
    .where(eq(s.registrations.status, "APPROVED"));
  let k = 0;
  for (const { r, p } of pros.filter((x) => x.p.professionalLevel !== "AMATEUR")) {
    k++;
    const end = k % 9 === 0 ? new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10) : `${Number(season.name.slice(0, 4)) + 2}-06-30`;
    await db.insert(s.contracts).values({ registrationId: r.id, playerId: p.id, clubId: r.clubId, startDate: season.startDate, endDate: end, monthlySalary: String(2000 + (k % 7) * 500), totalValue: String((2000 + (k % 7) * 500) * 24), housing: k % 2 === 0 });
    await db.update(s.registrations).set({ contractStart: season.startDate, contractEnd: end }).where(eq(s.registrations.id, r.id));
  }
  await db.update(s.ageCategories).set({ maxForeign: 4 }).where(sql`${s.ageCategories.maxAge} is null`);

  // مسابقة وجدول
  const [comp] = await db.insert(s.competitions).values({ seasonId: season.id, name: "الدوري الليبي الممتاز", type: "LEAGUE", legs: 2, status: "ACTIVE", maxForeign: 4, maxForeignOnPitch: 3, yellowRules: "3:1,5:1,7:2", startDate: new Date().toISOString().slice(0, 10) }).returning();
  await db.insert(s.competitionTeams).values(clubs.map((c) => ({ competitionId: comp.id, clubId: c.id })));
  const fx = roundRobin(clubs.map((c) => c.id), 2);
  const base = new Date(); base.setHours(16, 0, 0, 0); base.setDate(base.getDate() + 2);
  const ms = await db.insert(s.matches).values(fx.map((m) => {
    const k = new Date(base.getTime() + (m.round - 1) * 7 * 864e5);
    const h = clubs.find((c) => c.id === m.home)!;
    return { competitionId: comp.id, round: m.round, homeClubId: m.home, awayClubId: m.away, kickoff: k, venue: h.stadium, city: h.city };
  })).returning();
  // تعيين طاقم للمباراة الأولى واعتماده
  const m1 = ms[0];
  await db.insert(s.assignments).values([
    { matchId: m1.id, officialId: offs[0].id, role: "REFEREE", status: "APPROVED", assignedBy: "رئيس لجنة الحكام", approvedBy: "رئيس لجنة الحكام", approvedAt: new Date() },
    { matchId: m1.id, officialId: offs[3].id, role: "AR1", status: "APPROVED", assignedBy: "رئيس لجنة الحكام", approvedBy: "رئيس لجنة الحكام", approvedAt: new Date() },
    { matchId: m1.id, officialId: offs[4].id, role: "AR2", status: "APPROVED", assignedBy: "رئيس لجنة الحكام", approvedBy: "رئيس لجنة الحكام", approvedAt: new Date() },
    { matchId: m1.id, officialId: offs[6].id, role: "COMMISSIONER", status: "APPROVED", assignedBy: "رئيس لجنة الحكام", approvedBy: "رئيس لجنة الحكام", approvedAt: new Date() },
  ]);
  console.log(`✓ بيانات تجريبية: ${clubs.length} أندية، ${seq} لاعب، ${ms.length} مباراة — كلمة مرور الحسابات التجريبية: Test@12345`);
}

(async () => {
  await base();
  await migrate();
  if (process.env.SEED_DEMO === "1") {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(s.clubs);
    if (n === 0) await demo();
    else console.log("الأندية موجودة — تخطي البيانات التجريبية");
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
