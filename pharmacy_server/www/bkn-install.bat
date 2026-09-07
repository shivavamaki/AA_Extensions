@echo off
setlocal EnableExtensions EnableDelayedExpansion
title BKN Pharmacy Portal - Install / Update Extension
color 0B

:: ===================================================================
::  BKN Pharmacy Portal — extension installer
::
::  Download this file ONCE to your own PC (Desktop or Downloads) and
::  run it from there whenever a new version is announced.
::
::  Do NOT run it from the shared drive. A script on a share can be
::  replaced by anyone who can write to that folder, and would then run
::  on every workstation that launches it. Running your own local copy
::  removes that risk.
::
::  What it does:
::    1. asks the pharmacy server which version is published
::    2. downloads that version as a ZIP
::    3. checks the ZIP is real and contains manifest.json
::    4. only then replaces D:\pharmacy\BKNPharmacyPortal
::    5. opens Chrome so you can press the reload arrow
::
::  The live folder is not touched until the download is verified, so a
::  failed or interrupted update can never leave a half-installed
::  extension behind.
:: ===================================================================

set "SERVER=http://10.134.110.81:8765"
set "TARGET=D:\pharmacy\BKNPharmacyPortal"
set "WORK=%TEMP%\bkn-ext-install"

:: A copy of this file ships inside the package, so after the first install
:: it also sits in the install folder. That folder is DELETED during an
:: update - which would delete this script mid-run - so if we are running
:: from inside it, relaunch from a temp copy and let the original go.
if /i "%~dp0"=="%TARGET%\" goto :relaunch
goto :start

:relaunch
copy /y "%~f0" "%TEMP%kn-install-run.bat" >nul 2>&1
if errorlevel 1 (
  echo   Could not stage the installer in the temp folder.
  pause
  exit /b 1
)
start "" "%TEMP%kn-install-run.bat"
exit /b 0

:start

echo.
echo   ===================================================
echo      BKN Pharmacy Portal  -  Install / Update
echo   ===================================================
echo.
echo   Server : %SERVER%
echo   Install: %TARGET%
echo.

:: --- 1. what is published? --------------------------------------------
echo   Checking the pharmacy server...
set "REMOTE="
for /f "usebackq delims=" %%V in (`
  powershell -NoProfile -Command ^
    "try{(Invoke-RestMethod -TimeoutSec 15 '%SERVER%/api/ext-version').version}catch{''}"
`) do set "REMOTE=%%V"

if "%REMOTE%"=="" (
  color 0C
  echo.
  echo   ***  Cannot reach the pharmacy server.
  echo.
  echo        Tried:  %SERVER%
  echo.
  echo        Check that this PC is on the hospital network and that the
  echo        pharmacy server is switched on, then run this file again.
  echo.
  pause
  exit /b 1
)
echo   Published version: %REMOTE%

:: --- what is installed now? -------------------------------------------
set "LOCAL="
if exist "%TARGET%\manifest.json" (
  for /f "usebackq delims=" %%L in (`
    powershell -NoProfile -Command ^
      "try{(Get-Content -Raw '%TARGET%\manifest.json' ^| ConvertFrom-Json).version}catch{''}"
  `) do set "LOCAL=%%L"
)
if defined LOCAL (
  echo   Installed version: !LOCAL!
  if "!LOCAL!"=="%REMOTE%" (
    echo.
    echo   Already up to date - nothing to do.
    echo.
    goto :openchrome
  )
) else (
  echo   Installed version: ^(none - first install^)
)

:: --- 2. download -------------------------------------------------------
echo.
echo   Downloading version %REMOTE% ...
if exist "%WORK%" rmdir /s /q "%WORK%"
mkdir "%WORK%" 2>nul
powershell -NoProfile -Command ^
  "$ProgressPreference='SilentlyContinue';try{Invoke-WebRequest -TimeoutSec 180 -Uri '%SERVER%/ext-download' -OutFile '%WORK%\ext.zip' -ErrorAction Stop}catch{exit 1}"
if errorlevel 1 (
  echo   ***  Download failed.
  goto :fail
)

:: --- 3. verify BEFORE touching the install ----------------------------
echo   Checking the download...
powershell -NoProfile -Command ^
  "try{Expand-Archive -Force -Path '%WORK%\ext.zip' -DestinationPath '%WORK%\new' -ErrorAction Stop}catch{exit 1}"
if errorlevel 1 (
  echo   ***  The download is not a valid ZIP ^(file may be corrupt^).
  goto :fail
)
if not exist "%WORK%\new\manifest.json" (
  echo   ***  The package looks wrong ^(no manifest.json^).
  echo        Your current extension has NOT been changed.
  goto :fail
)

:: --- 4. install --------------------------------------------------------
echo   Installing...
if not exist "D:\pharmacy" mkdir "D:\pharmacy" 2>nul
if not exist "D:\pharmacy" (
  echo   ***  Cannot create D:\pharmacy on this PC.
  goto :fail
)
if exist "%TARGET%" rmdir /s /q "%TARGET%"
mkdir "%TARGET%" 2>nul

:: robocopy, not move: TEMP is usually on C: and the target on D:, and a
:: cross-volume move is unreliable. robocopy exit codes 0-7 are success
:: (8+ are real errors), so this cannot use a plain errorlevel test.
robocopy "%WORK%\new" "%TARGET%" /E /NFL /NDL /NJH /NJS /NP >nul
if %ERRORLEVEL% GEQ 8 (
  echo   ***  Could not write to %TARGET%
  echo        Close Chrome and run this file again.
  goto :fail
)
if not exist "%TARGET%\manifest.json" (
  echo   ***  Install did not complete.
  goto :fail
)

echo.
echo   Updated to version %REMOTE%.

:openchrome
echo.
echo   ================================================================
echo     LAST STEP - click the RELOAD arrow, then close that tab.
echo   ================================================================
echo.
echo     Chrome is opening at the extension page so the reload button
echo     is right there.
echo.
echo     (First time on this PC only: turn Developer mode ON, click
echo      "Load unpacked" and select  %TARGET% )
echo.

:: Resolve chrome.exe properly. `start "" chrome.exe` is NOT safe: chrome
:: is usually not on PATH, and Windows then offers to find it in the
:: Microsoft Store - never let that happen on a ward PC.
set "CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if not defined CHROME for /f "usebackq skip=2 tokens=2,*" %%A in (
  `reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" /ve 2^>nul`
) do if not defined CHROME set "CHROME=%%B"

:: These PCs have many Chrome profiles; opening the wrong one shows the
:: "Who's using Chrome?" picker, which is a dead end for a pharmacist.
:: Read the profile Chrome itself last used.
set "CHPROFILE="
for /f "usebackq delims=" %%A in (`
  powershell -NoProfile -Command ^
    "try{(Get-Content -Raw '%LOCALAPPDATA%\Google\Chrome\User Data\Local State' ^| ConvertFrom-Json).profile.last_used}catch{''}"
`) do set "CHPROFILE=%%A"
if not defined CHPROFILE set "CHPROFILE=Default"

:: An ordinary http page, NOT chrome://extensions - Chrome silently drops
:: a chrome:// URL given on the command line. The served page carries a
:: click-through instead.
if defined CHROME (
  start "" "%CHROME%" --profile-directory="%CHPROFILE%" "%SERVER%/reload-extension"
) else (
  echo   NOTE: Chrome was not found automatically. Open Chrome yourself,
  echo         go to  chrome://extensions  and click the reload arrow.
)

if exist "%WORK%" rmdir /s /q "%WORK%" 2>nul
echo.
pause
exit /b 0

:fail
color 0C
if exist "%WORK%" rmdir /s /q "%WORK%" 2>nul
echo.
echo        Your current extension has NOT been changed.
echo.
pause
exit /b 1
