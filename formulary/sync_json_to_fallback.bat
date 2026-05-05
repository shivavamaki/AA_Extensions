@echo off
cd /d %~dp0
powershell -NoProfile -ExecutionPolicy Bypass -Command "$json = Get-Content -Raw data\formulas.json; Set-Content -Encoding UTF8 data\default_formulas.js ('window.DEFAULT_FORMULAS = ' + $json + ';')"
echo Synced data\formulas.json to data\default_formulas.js
pause
