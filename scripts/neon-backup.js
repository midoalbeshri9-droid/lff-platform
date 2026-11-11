// نسخة احتياطية كاملة من المنظومة إلى هذا الجهاز: قاعدة البيانات (Neon) + الملفات المرفوعة (R2)
//   data\backups\<التاريخ>\      : جداول قاعدة البيانات (JSON) + manifest.json
//   data\backups\files\          : الملفات المرفوعة (تُنزّل الجديدة فقط في كل مرة)
// تشغيل: neon-backup.bat   (أو "neon-backup.bat auto" بدون توقف — للجدولة الأسبوعية)
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { Client } = require("pg");

const root = path.resolve(__dirname, "..");
const urlFile = path.join(root, "neon-url.txt");
if (!fs.existsSync(urlFile)) { console.log("neon-url.txt not found"); process.exit(1); }
const dbUrl = fs.readFileSync(urlFile, "utf8").trim().replace(/&?channel_binding=require/, "").replace("-pooler.", ".");
const siteFile = path.join(root, "site-url.txt");
const site = (fs.existsSync(siteFile) ? fs.readFileSync(siteFile, "utf8").trim() : "https://lff-platform.vercel.app").replace(/\/$/, "");
const KEEP = 20; // عدد نسخ قاعدة البيانات المحفوظة (الأقدم يُحذف)

const pad = (n) => String(n).padStart(2, "0");
const d = new Date();
const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
const base = path.join(root, "data", "backups");
const dbDir = path.join(base, stamp);
const filesDir = path.join(base, "files");
const log = [];
const say = (s) => { console.log(s); log.push(s); };

async function files() {
  const pg = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await pg.connect();
  const key = crypto.randomBytes(32).toString("hex");
  const hash = crypto.createHash("sha256").update(key).digest("hex");
  // مفتاح مؤقت صالح ساعتين، يُحذف في النهاية
  await pg.query(`insert into settings (key, value) values ('backup_key_hash', $1) on conflict (key) do update set value = excluded.value`, [`${hash}|${Date.now() + 2 * 3600e3}`]);
  try {
    const h = { "x-backup-key": key };
    const r = await fetch(`${site}/api/backup`, { headers: h });
    if (!r.ok) throw new Error(`list failed: HTTP ${r.status} (is the latest version deployed?)`);
    const list = await r.json();
    let got = 0, skip = 0, bytes = 0;
    const failed = [];
    for (const o of list) {
      if (o.key.includes("..")) continue;
      const dest = path.join(filesDir, ...o.key.split("/"));
      if (fs.existsSync(dest) && fs.statSync(dest).size === o.size) { skip++; continue; }
      try {
        const f = await fetch(`${site}/api/backup?key=${encodeURIComponent(o.key)}`, { headers: h });
        if (!f.ok) throw new Error(`HTTP ${f.status}`);
        const buf = Buffer.from(await f.arrayBuffer());
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buf);
        got++; bytes += buf.length;
        if (got % 25 === 0) console.log(`  ... ${got} files`);
      } catch (e) { failed.push(`${o.key}: ${e.message}`); }
    }
    say(`Files: ${list.length} total, ${got} new (${(bytes / 1048576).toFixed(1)} MB), ${skip} already saved${failed.length ? `, ${failed.length} FAILED` : ""}`);
    for (const x of failed.slice(0, 20)) say(`  ! ${x}`);
    return failed.length === 0;
  } finally {
    await pg.query(`delete from settings where key = 'backup_key_hash'`).catch(() => {});
    await pg.end();
  }
}

(async () => {
  say(`LFF backup ${stamp}`);
  say("1) Database ...");
  const env = { ...process.env, DATABASE_URL: dbUrl, DIRECT_URL: dbUrl, DATABASE_SSL: "true" };
  const ok = spawnSync(`npx tsx src/db/backup.ts backup "${dbDir}"`, { cwd: root, env, stdio: "inherit", shell: true }).status === 0;
  if (!ok) { console.log("DATABASE BACKUP FAILED"); process.exit(1); }
  say("Database: OK");
  say("2) Uploaded files ...");
  let fok = false;
  try { fok = await files(); } catch (e) { say(`FILES BACKUP FAILED: ${e.message}`); }
  // الاحتفاظ بآخر KEEP نسخة فقط من قاعدة البيانات (مجلد الملفات مشترك ولا يُحذف منه شيء)
  const olds = fs.readdirSync(base).filter((n) => /^\d{4}-\d{2}-\d{2}_\d{4}$/.test(n)).sort();
  for (const n of olds.slice(0, Math.max(0, olds.length - KEEP))) fs.rmSync(path.join(base, n), { recursive: true, force: true });
  fs.writeFileSync(path.join(dbDir, "backup-log.txt"), log.join("\n"), "utf8");
  fs.writeFileSync(path.join(root, "data", "backup.ok"), new Date().toISOString());
  console.log(`\n${fok ? "DONE" : "DONE (database OK, files had problems - see above)"}`);
  console.log(`Saved to: data\\backups\\${stamp}  and  data\\backups\\files`);
})();
