// مطابقة القيود مع القوائم النهائية على قاعدة Neon
// check: فحص فقط (لا يغيّر شيئًا) — apply: إلغاء قيود غير المدرجين حسب خطة الفحص الأخير
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { spawnSync } = require("child_process");
const root = path.resolve(__dirname, "..");
const mode = process.argv[2] === "apply" ? "apply" : "check";
const file = path.join(root, "neon-url.txt");
if (!fs.existsSync(file)) { console.log("✗ الملف neon-url.txt غير موجود"); process.exit(1); }
const url = fs.readFileSync(file, "utf8").trim().replace(/&?channel_binding=require/, "").replace("-pooler.", ".");
const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url, DATABASE_SSL: "true" };
const run = (cmd) => { const r = spawnSync(cmd, { cwd: root, env, stdio: "inherit", shell: true }); return r.status === 0; };
const plan = path.join(root, "data", "squads-plan.json");
if (mode === "check") {
  for (const f of ["squads-check.ok", "squads-apply.ok"]) try { fs.unlinkSync(path.join(root, "data", f)); } catch {}
  if (!fs.existsSync(path.join(root, "data", "import", "final-lists-2026.json"))) { console.log("✗ ملف القوائم data\\import\\final-lists-2026.json غير موجود"); process.exit(1); }
  if (!run("npx tsx src/db/finalize-squads.ts check data/import/final-lists-2026.json data/squads-report.txt")) { console.log("✗ فشل الفحص"); process.exit(1); }
  fs.writeFileSync(path.join(root, "data", "squads-check.ok"), new Date().toISOString());
  console.log("\n✓ انتهى الفحص — لم يتغير شيء. التقرير: data\\squads-report.txt");
} else {
  if (!fs.existsSync(plan)) { console.log("✗ شغّل الفحص أولًا (neon-squads-check.bat)"); process.exit(1); }
  const n = JSON.parse(fs.readFileSync(plan, "utf8")).cancel.length;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(`Apply plan (cancel ${n} registrations, no deletion)? Type yes: `, (a) => {
    rl.close();
    if (a.trim() !== "نعم" && a.trim().toLowerCase() !== "yes") { console.log("أُلغي التنفيذ — لم يتغير شيء"); return; }
    if (!run("npx tsx src/db/finalize-squads.ts apply data/squads-plan.json")) { console.log("✗ فشل التنفيذ"); process.exit(1); }
    fs.writeFileSync(path.join(root, "data", "squads-apply.ok"), new Date().toISOString());
  });
}
