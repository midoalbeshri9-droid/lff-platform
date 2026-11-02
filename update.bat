@echo off
chcp 65001 >nul
title تحديث منظومة الاتحاد الليبي لكرة القدم
cd /d "%~dp0"
echo ================================================
echo   تحديث المنظومة — بياناتك الحالية تبقى كما هي
echo ================================================
echo أغلق نافذة تشغيل المنظومة (run.bat) قبل المتابعة.
echo.
echo [1/4] تحديث الحزم ...
call npm install --no-audit --no-fund
if errorlevel 1 goto err
echo [2/4] تحديث هيكل قاعدة البيانات ...
call npx drizzle-kit push --force
if errorlevel 1 goto err
echo [3/4] ترحيل البيانات والإعدادات الجديدة ...
call npx tsx src\db\migrate.ts
if errorlevel 1 goto err
echo [4/4] بناء المنظومة ...
call npm run build
if errorlevel 1 goto err
echo.
echo ================================================
echo   ✓ اكتمل التحديث — شغّل run.bat
echo ================================================
echo UPDATE-DONE> data\update.ok
pause
exit /b
:err
echo.
echo ✗ حدث خطأ — راجع الرسالة أعلاه
echo UPDATE-FAILED> update-failed.txt
pause
