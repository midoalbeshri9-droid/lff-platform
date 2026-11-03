@echo off
chcp 65001 >nul
title استيراد الأندية
cd /d "%~dp0"
node scripts\neon-import-clubs.js
pause
