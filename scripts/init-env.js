// ينشئ ملف .env تلقائيًا (قاعدة مدمجة + مفتاح أمان عشوائي) إن لم يكن موجودًا
const fs = require("fs");
const crypto = require("crypto");
if (fs.existsSync(".env")) { console.log(".env موجود مسبقًا"); process.exit(0); }
let s = fs.readFileSync(".env.example", "utf8");
s = s.replace(/^AUTH_SECRET=.*$/m, `AUTH_SECRET="${crypto.randomBytes(32).toString("hex")}"`);
fs.writeFileSync(".env", s);
console.log("تم إنشاء .env");
