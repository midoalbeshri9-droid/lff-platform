// طوارئ: إلغاء التحقق بخطوتين لحساب فقد صاحبه هاتفه ورموز الاسترداد (مثل حساب مدير المنظومة الوحيد)
// يعمل من جهاز الاتحاد فقط لأنه يقرأ رابط القاعدة من neon-url.txt — لا يغيّر كلمة المرور
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const root = path.resolve(__dirname, "..");
const file = path.join(root, "neon-url.txt");
if (!fs.existsSync(file)) { console.log("✗ الملف neon-url.txt غير موجود"); process.exit(1); }
const url = fs.readFileSync(file, "utf8").trim().replace(/&?channel_binding=require/, "");
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question("اسم المستخدم المطلوب إلغاء التحقق بخطوتين له: ", async (name) => {
  rl.close();
  const { Client } = require("pg");
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const r = await c.query(
    "update users set totp_enabled=false, totp_secret=null, totp_backup=null, totp_last_step=null, session_version=session_version+1 where lower(username)=lower($1) returning full_name",
    [name.trim()],
  );
  if (!r.rowCount) console.log("✗ لا يوجد مستخدم بهذا الاسم");
  else {
    await c.query("insert into audit_logs (user_name, action, entity, details) values ($1,$2,$3,$4)", ["سكربت الطوارئ", "إلغاء التحقق بخطوتين", "User", JSON.stringify({ username: name.trim() })]).catch(() => {});
    console.log(`✓ أُلغي التحقق بخطوتين لـ ${r.rows[0].full_name} — سيُطلب منه ربط هاتفه عند الدخول`);
  }
  await c.end();
});
