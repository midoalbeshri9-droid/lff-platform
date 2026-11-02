@echo off
chcp 65001 >nul
title تحديث قاعدة Neon
cd /d "%~dp0"
node scripts\neon-update.js
pause
