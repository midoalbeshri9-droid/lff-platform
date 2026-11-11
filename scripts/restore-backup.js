// استرجاع نسخة احتياطية إلى قاعدة بيانات جديدة (خادم جديد أو تشغيل محلي) — لا يلمس Neon الحالية
//   الهدف: restore-url.txt (رابط PostgreSQL جديد) إن وُجد، وإلا قاعدة محلية في data\restored-db
//   النسخة: آخر مجلد في data\backups أو اسم المجلد كوسيط
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const base = path.join(root, "data", "backups");
const all = fs.existsSync(base) ? fs.readdirSync(base).filter((n) => /^\d{4}-\d{2}-\d{2}_\d{4}$/.test(n)).sort() : [];
const pick = process.argv[2] || all[all.length - 1];
if (!pick || !fs.existsSync(path.join(base, pick, "manifest.json"))) { console.log("No backup found in data\\backups"); process.exit(1); }
const neon = fs.existsSync(path.join(root, "neon-url.txt")) ? fs.readFileSync(path.join(root, "neon-url.txt"), "utf8").trim() : "";
const rf = path.join(root, "restore-url.txt");
const target = fs.existsSync(rf) ? fs.readFileSync(rf, "utf8").trim().replace(/&?channel_binding=require/, "") : "pglite:./data/restored-db";
const host = (u) => (u.match(/@([^/?]+)/) || [])[1] || u;
if (neon && !target.startsWith("pglite:") && host(target).replace("-pooler.", ".") === host(neon).replace("-pooler.", ".")) {
  console.log("restore-url.txt points to the LIVE Neon database - refusing. Use a NEW empty database."); process.exit(1);
}
console.log(`Backup : ${pick}`);
console.log(`Target : ${target.startsWith("pglite:") ? "local database (data\\restored-db)" : host(target)}`);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question("Create the tables and restore this backup into the target? Type yes: ", (a) => {
  rl.close();
  if (!["yes", "نعم"].includes(a.trim().toLowerCase())) { console.log("Cancelled"); return; }
  const env = { ...process.env, DATABASE_URL: target, DIRECT_URL: target, DATABASE_SSL: target.startsWith("pglite:") ? "" : "true" };
  const run = (c) => spawnSync(c, { cwd: root, env, stdio: "inherit", shell: true }).status === 0;
  if (!run("npx drizzle-kit push --force")) { console.log("FAILED creating tables"); process.exit(1); }
  if (!run(`npx tsx src/db/backup.ts restore "${path.join(base, pick)}" --force`)) { console.log("RESTORE FAILED"); process.exit(1); }
  console.log("\nDone. Uploaded files are in data\\backups\\files (copy them to the new storage).");
});
