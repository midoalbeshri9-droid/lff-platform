// إعداد الدوري الممتاز على قاعدة Neon — check: فحص فقط، apply: تنفيذ
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { spawnSync } = require("child_process");
const root = path.resolve(__dirname, "..");
const mode = process.argv[2] === "apply" ? "apply" : "check";
const file = path.join(root, "neon-url.txt");
if (!fs.existsSync(file)) { console.log("neon-url.txt not found"); process.exit(1); }
for (const f of ["league-2026.json", "observers-2026.json"]) if (!fs.existsSync(path.join(root, "data", "import", f))) { console.log("missing data/import/" + f); process.exit(1); }
const url = fs.readFileSync(file, "utf8").trim().replace(/&?channel_binding=require/, "").replace("-pooler.", ".");
const env = { ...process.env, DATABASE_URL: url, DIRECT_URL: url, DATABASE_SSL: "true" };
const run = () => spawnSync(`npx tsx src/db/import-league.ts ${mode} data/import/league-2026.json data/import/observers-2026.json data/league-report.txt`, { cwd: root, env, stdio: "inherit", shell: true }).status === 0;
const ok = () => fs.writeFileSync(path.join(root, "data", `league-${mode}.ok`), new Date().toISOString());
if (mode === "check") { if (!run()) { console.log("FAILED"); process.exit(1); } ok(); console.log("\nDone (nothing changed). Report: data\\league-report.txt"); }
else {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question("Create the league, fixtures (weeks 1-4) and observers? Type yes: ", (a) => {
    rl.close();
    if (!["yes", "نعم"].includes(a.trim().toLowerCase())) { console.log("Cancelled - nothing changed"); return; }
    if (!run()) { console.log("FAILED"); process.exit(1); }
    ok(); console.log("\nDone. Report: data\\league-report.txt");
  });
}
