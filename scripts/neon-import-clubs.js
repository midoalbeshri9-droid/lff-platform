// استيراد أندية الدوري الممتاز إلى قاعدة Neon (لا يحذف ولا يكرر)
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const root = path.resolve(__dirname, "..");
const file = path.join(root, "neon-url.txt");
if (!fs.existsSync(file)) { console.log("✗ الملف neon-url.txt غير موجود"); process.exit(1); }
const url = fs.readFileSync(file, "utf8").trim().replace(/&?channel_binding=require/, "").replace("-pooler.", ".");
const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url, DATABASE_SSL: "true", SEED_DEMO: "" };
const r = spawnSync("npx tsx src/db/import-clubs.ts scripts/clubs-premier.json", { cwd: root, env, stdio: ["inherit", "pipe", "inherit"], shell: true, encoding: "utf8" });
process.stdout.write(r.stdout || "");
fs.mkdirSync(path.join(root, "data"), { recursive: true });
if (r.status !== 0) { console.log("✗ فشل الاستيراد"); fs.writeFileSync(path.join(root, "data", "import-clubs.failed"), String(r.stdout)); process.exit(1); }
fs.writeFileSync(path.join(root, "data", "import-clubs.ok"), new Date().toISOString() + "\n" + r.stdout);
console.log("\n✓ تم استيراد الأندية إلى Neon");
