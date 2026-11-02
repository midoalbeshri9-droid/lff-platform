@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo إعادة بناء المنظومة بعد أي تعديل في الكود ...
call npm run build
pause
