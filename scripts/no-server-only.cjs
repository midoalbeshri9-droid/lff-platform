// تشغيل مكتبات المنظومة من سكربت خارج Next.js: «server-only» يصبح ملفًا فارغًا
const Module = require("module");
const orig = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  if (req === "server-only") return require("path").join(__dirname, "empty-module.cjs");
  return orig.call(this, req, ...rest);
};
