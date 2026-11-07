@echo off
chcp 65001 >nul
title تنفيذ القوائم النهائية
cd /d "%~dp0"
node scripts\neon-squads.js apply
pause
