@echo off
chcp 65001 >nul
title LFF backup
cd /d "%~dp0"
node scripts\neon-backup.js
if /i not "%1"=="auto" pause
