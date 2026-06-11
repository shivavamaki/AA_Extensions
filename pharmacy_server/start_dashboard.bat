@echo off
REM Launch BKN Pharmacy Server + Web Pixi dashboard.
REM Default URL: http://127.0.0.1:8765/dashboard
cd /d "%~dp0"

set PORT=8765
set ARGS=%*

:parse_args
if "%~1"=="" goto start_server
if /I "%~1"=="--port" (
  if not "%~2"=="" set PORT=%~2
)
shift
goto parse_args

:start_server
start "BKN Pharmacy Server" python "%~dp0bkn_ks_server.py" %ARGS%
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:%PORT%/dashboard"
