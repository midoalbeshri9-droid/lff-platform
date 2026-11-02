@echo off
chcp 65001 >nul
title منظومة الاتحاد الليبي لكرة القدم — http://localhost:3000
cd /d "%~dp0"
if not exist ".next\BUILD_ID" (
  echo بناء المنظومة لأول مرة ...
  call npm run build
)
echo المنظومة تعمل على http://localhost:3000  — لا تغلق هذه النافذة
start "" http://localhost:3000
call npm start
