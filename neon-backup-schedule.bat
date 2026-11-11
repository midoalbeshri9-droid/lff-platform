@echo off
chcp 65001 >nul
cd /d "%~dp0"
schtasks /create /tn "LFF Weekly Backup" /tr "\"%~dp0neon-backup.bat\" auto" /sc weekly /d THU /st 22:00 /f
if errorlevel 1 (echo FAILED) else (echo Weekly backup scheduled: every Thursday 22:00)
pause
