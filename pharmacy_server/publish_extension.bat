@echo off
setlocal EnableExtensions EnableDelayedExpansion
title BKN Pharmacy Portal - Publish Extension
color 0E

:: ===================================================================
::  Publish the current extension build to the pharmacy server.
::
::  The server packages BKNPharmacyPortal/ on demand and caches the ZIP
::  per manifest version, so "publishing" means: make sure the manifest
::  version is bumped, then warm the package so the first workstation
::  doesn't wait for the build.
::
::  Run this on the SERVER machine after bumping the version.
:: ===================================================================

set "SERVER=http://127.0.0.1:8765"

echo.
echo   ===================================================
echo      BKN Pharmacy Portal  -  Publish Extension
echo   ===================================================
echo.

:: --- what does the server think it is publishing? ----------------------
for /f "usebackq delims=" %%V in (`
  powershell -NoProfile -Command ^
    "try{(Invoke-RestMethod -TimeoutSec 10 '%SERVER%/api/ext-version').version}catch{''}"
`) do set "VER=%%V"

if "%VER%"=="" (
  color 0C
  echo   ***  Cannot reach the pharmacy server at %SERVER%
  echo.
  echo        Start it first ^(start_server.bat^), then run this again.
  echo.
  pause
  exit /b 1
)

echo   Version to publish:  %VER%
echo.
echo   Building / warming the package...

:: Force the build now so the first workstation gets a cached ZIP.
powershell -NoProfile -Command ^
  "try{$r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 180 -Uri '%SERVER%/ext-download' -OutFile $env:TEMP\bkn-pub-check.zip; exit 0}catch{exit 1}"
if errorlevel 1 (
  color 0C
  echo   ***  Package build failed. Check the server console for details.
  echo.
  pause
  exit /b 1
)

for %%A in ("%TEMP%\bkn-pub-check.zip") do set "SIZE=%%~zA"
del /q "%TEMP%\bkn-pub-check.zip" >nul 2>&1

echo   Package ready:  %SIZE% bytes
echo.
echo   ---------------------------------------------------
echo    Published version %VER%
echo   ---------------------------------------------------
echo.
echo    Tell the pharmacy staff to run:
echo       BKN-Update-Extension.bat
echo    then click the reload arrow in chrome://extensions
echo.
echo    Staff who do not have that file yet can get it from:
echo       %SERVER%/update-extension
echo.

:: Reminder: the ZIP is cached per manifest version, so an edit without a
:: version bump will NOT reach the workstations.
echo    NOTE: if you changed code but not the manifest version, the
echo          workstations will still see %VER% and skip the update.
echo.
pause
exit /b 0
