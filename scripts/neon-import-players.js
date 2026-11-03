// استيراد أندية الدوري الممتاز ثم القوائم النهائية للاعبين إلى قاعدة Neon (لا يحذف ولا يكرر)
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const root = path.resolve(__dirname, "..");
const file = path.join(root, "neon-url.txt");
if (!fs.existsSync(file)) { console.log("✗ الملف neon-url.txt غير موجود"); process.exit(1); }
if (!fs.existsSync(path.join(root, "data", "import", "players.json"))) { console.log("✗ ملف اللاعبين data\\import\\players.json غير موجود"); process.exit(1); }
const url = fs.readFileSync(file, "utf8").trim().replace(/&?channel_binding=require/, "").replace("-pooler.", ".");
const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url, DATABASE_SSL: "true", SEED_DEMO: "" };
const run = (label, cmd) => {
  console.log("\n" + label);
  const r = spawnSync(cmd, { cwd: root, env, stdio: "inherit", shell: true });
  if (r.status !== 0) { console.log("✗ فشل: " + label); fs.writeFileSync(path.join(root, "data", "import-players.failed"), label); process.exit(1); }
};
run("[1/2] الأندية ...", "npx tsx src/db/import-clubs.ts scripts/clubs-premier.json");
run("[2/2] اللاعبون ...", "npx tsx src/db/import-players.ts data/import/players.json data/import-players-report.txt");
fs.writeFileSync(path.join(root, "data", "import-players.ok"), new Date().toISOString());
console.log("\n✓ تم — التقرير في data\\import-players-report.txt");
