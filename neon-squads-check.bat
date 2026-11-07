@echo off
chcp 65001 >nul
title فحص القوائم النهائية
cd /d "%~dp0"
node scripts\neon-squads.js check
pause
