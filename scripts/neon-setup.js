// تجهيز قاعدة Neon لأول مرة: إنشاء الجداول + الإعدادات الأساسية + حساب المدير (بدون بيانات تجريبية)
// يقرأ رابط الاتصال من الملف neon-url.txt (لا يُرفع إلى GitHub)
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const readline = require("readline");

const root = path.resolve(__dirname, "..");
const file = path.join(root, "neon-url.txt");
if (!fs.existsSync(file)) { console.log("✗ الملف neon-url.txt غير موجود"); process.exit(1); }
let url = fs.readFileSync(file, "utf8").trim().replace(/&?channel_binding=require/, "");
const direct = url.replace("-pooler.", ".");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question("اكتب كلمة مرور جديدة لحساب المدير admin (8 أحرف على الأقل، حرف كبير وصغير ورقم): ", (pw) => {
  rl.close();
  pw = (pw || "").trim();
  if (pw.length < 8 || !/[A-Z]/.test(pw) || !/[a-z]/.test(pw) || !/\d/.test(pw)) { console.log("✗ كلمة المرور ضعيفة — أعد التشغيل"); process.exit(1); }
  const env = { ...process.env, DATABASE_URL: direct, DIRECT_URL: direct, DATABASE_SSL: "true", SEED_DEMO: "", SEED_ADMIN_PASSWORD: pw };
  const run = (label, cmd) => {
    console.log("\n" + label);
    const r = spawnSync(cmd, { cwd: root, env, stdio: "inherit", shell: true });
    if (r.status !== 0) { console.log("✗ فشل: " + label); process.exit(1); }
  };
  run("[1/3] إنشاء الجداول على Neon ...", "npx drizzle-kit push --force");
  run("[2/3] الإعدادات الأساسية وحساب المدير ...", "npx tsx src/db/seed.ts");
  run("[3/3] ترحيل الإعدادات ...", "npx tsx src/db/migrate.ts");
  fs.writeFileSync(path.join(root, "data", "neon.ok"), "NEON-DONE");
  console.log("\n✓ قاعدة Neon جاهزة. المستخدم: admin وكلمة المرور التي كتبتها.");
});
