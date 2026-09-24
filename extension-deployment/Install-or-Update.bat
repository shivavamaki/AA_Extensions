@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Update.ps1"
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" echo Operation failed. Read the error above. Do not remove your current extension.
pause
exit /b %RC%
