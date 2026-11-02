// تحديث هيكل قاعدة Neon وترحيل البيانات (بدون حذف أي بيانات) — شغّله قبل نشر نسخة جديدة على Vercel
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const root = path.resolve(__dirname, "..");
const file = path.join(root, "neon-url.txt");
if (!fs.existsSync(file)) { console.log("✗ الملف neon-url.txt غير موجود"); process.exit(1); }
const url = fs.readFileSync(file, "utf8").trim().replace(/&?channel_binding=require/, "").replace("-pooler.", ".");
const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url, DATABASE_SSL: "true", SEED_DEMO: "" };
const run = (label, cmd) => {
  console.log("\n" + label);
  const r = spawnSync(cmd, { cwd: root, env, stdio: "inherit", shell: true });
  if (r.status !== 0) { console.log("✗ فشل: " + label); fs.writeFileSync(path.join(root, "neon-update-failed.txt"), label); process.exit(1); }
};
run("[1/2] تحديث هيكل قاعدة Neon ...", "npx drizzle-kit push --force");
run("[2/2] ترحيل البيانات ...", "npx tsx src/db/migrate.ts");
fs.mkdirSync(path.join(root, "data"), { recursive: true });
fs.writeFileSync(path.join(root, "data", "neon-update.ok"), new Date().toISOString());
console.log("\n✓ تم تحديث قاعدة Neon");
