@echo off
chcp 65001 >nul
title تجهيز قاعدة البيانات على Neon
cd /d "%~dp0"
node scripts\neon-setup.js
pause
