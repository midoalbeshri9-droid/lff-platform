// استيراد قرارات الجولات 1-3 على قاعدة Neon — check: فحص فقط، apply: تنفيذ
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { spawnSync } = require("child_process");
const root = path.resolve(__dirname, "..");
const mode = process.argv[2] === "apply" ? "apply" : "check";
const file = path.join(root, "neon-url.txt");
if (!fs.existsSync(file)) { console.log("neon-url.txt not found"); process.exit(1); }
for (const f of ["decisions-w1-3.json"]) if (!fs.existsSync(path.join(root, "data", "import", f))) { console.log("missing data/import/" + f); process.exit(1); }
const url = fs.readFileSync(file, "utf8").trim().replace(/&?channel_binding=require/, "").replace("-pooler.", ".");
const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url, DATABASE_SSL: "true" };
const run = () => spawnSync(`npx tsx --require ./scripts/no-server-only.cjs src/db/import-decisions.ts ${mode} data/import/decisions-w1-3.json data/decisions-report.txt`, { cwd: root, env, stdio: "inherit", shell: true }).status === 0;
const ok = () => fs.writeFileSync(path.join(root, "data", `decisions-${mode}.ok`), new Date().toISOString());
if (mode === "check") { if (!run()) { console.log("FAILED"); process.exit(1); } ok(); console.log("\nDone (nothing changed). Report: data\\decisions-report.txt"); }
else {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question("Import decisions 02-08 (results, cards, sanctions)? Type yes: ", (a) => {
    rl.close();
    if (!["yes", "نعم"].includes(a.trim().toLowerCase())) { console.log("Cancelled - nothing changed"); return; }
    if (!run()) { console.log("FAILED"); process.exit(1); }
    ok(); console.log("\nDone. Report: data\\decisions-report.txt");
  });
}
