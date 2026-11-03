@echo off
chcp 65001 >nul
title استيراد الأندية واللاعبين
cd /d "%~dp0"
node scripts\neon-import-players.js
pause
