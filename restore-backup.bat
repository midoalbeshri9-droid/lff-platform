@echo off
chcp 65001 >nul
title LFF restore
cd /d "%~dp0"
node scripts\restore-backup.js %1
pause
