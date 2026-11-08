@echo off
chcp 65001 >nul
cd /d "%~dp0"
node scripts\neon-decisions.js apply
pause
