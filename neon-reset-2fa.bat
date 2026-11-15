@echo off
chcp 65001 >nul
title طوارئ: إلغاء التحقق بخطوتين لحساب
cd /d "%~dp0"
node scripts\neon-reset-2fa.js
pause
