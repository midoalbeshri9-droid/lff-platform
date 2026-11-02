@echo off
chcp 65001 >nul
title تجهيز منظومة الاتحاد الليبي لكرة القدم
cd /d "%~dp0"
echo ================================================
echo   تجهيز منظومة القيد والمسابقات والحكام
echo ================================================

where node >nul 2>nul
if errorlevel 1 (
  echo [1/5] تثبيت Node.js ...
  winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements --silent
  set "PATH=%PATH%;C:\Program Files\nodejs"
)
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo تم تثبيت Node.js — أغلق النافذة وشغّل setup.bat مرة أخرى.
  pause
  exit /b
)
echo [1/5] Node.js:
node -v

echo [2/5] إعداد ملف الإعدادات ...
node scripts\init-env.js

echo [3/5] تثبيت الحزم (قد يستغرق دقائق) ...
call npm install --no-audit --no-fund
if errorlevel 1 goto err

echo [4/5] إنشاء قاعدة البيانات والبيانات الأولية ...
call npx drizzle-kit push --force
if errorlevel 1 goto err
set SEED_DEMO=1
call npx tsx src\db\seed.ts
if errorlevel 1 goto err
call npx tsx src\db\migrate.ts
if errorlevel 1 goto err

echo [5/5] بناء المنظومة ...
call npm run build
if errorlevel 1 goto err

echo.
echo ================================================
echo   ✓ اكتمل التجهيز — شغّل run.bat
echo ================================================
echo SETUP-DONE> data\setup.ok
pause
exit /b

:err
echo.
echo ✗ حدث خطأ — راجع الرسالة أعلاه
echo SETUP-FAILED> setup-failed.txt
pause
