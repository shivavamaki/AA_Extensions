@echo off
setlocal EnableExtensions
title BKN Pharmacy Portal - Update Extension
color 0B

:: ===================================================================
::  BKN Pharmacy Portal — one-click extension updater
::
::  Copy this ONE file to the workstation (Desktop is fine) and
::  double-click it whenever a new version is announced.
::
::  It downloads the current sync script from the pharmacy server and
::  runs it, so this file never goes out of date — the logic always
::  comes fresh from the server.
::
::  If the server ever moves, change SERVER below (one line).
:: ===================================================================

set "SERVER=http://10.134.110.81:8765"
set "BOOT=%TEMP%\bkn-ext-sync-boot.bat"

echo.
echo   ===================================================
echo      BKN Pharmacy Portal  -  Update Extension
echo   ===================================================
echo.
echo   Contacting the pharmacy server...
echo.

:: Pull the real sync script (it arrives with the server URL already
:: filled in, so nothing here needs to be kept in step with it).
if exist "%BOOT%" del /q "%BOOT%" >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try{Invoke-WebRequest -UseBasicParsing -TimeoutSec 20 -Uri '%SERVER%/ext-sync.bat' -OutFile '%BOOT%'}catch{exit 1}"

if errorlevel 1 goto :nosrv
if not exist "%BOOT%" goto :nosrv

:: Hand over to the downloaded script (it prints its own progress,
:: does the version check, and pauses at the end).
call "%BOOT%"
set "RC=%ERRORLEVEL%"
del /q "%BOOT%" >nul 2>&1
exit /b %RC%

:nosrv
color 0C
echo   ***  Cannot reach the pharmacy server.
echo.
echo        Tried:  %SERVER%
echo.
echo        Please check that:
echo          1. This PC is connected to the hospital network
echo          2. The pharmacy server is switched on
echo.
echo        If the server address has changed, edit this file and
echo        update the SERVER line near the top.
echo.
pause
exit /b 1
