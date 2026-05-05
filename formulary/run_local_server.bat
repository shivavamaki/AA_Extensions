@echo off
cd /d "%~dp0"
echo Starting BKN Formula Web App...
echo.
echo Open this URL in Chrome:
echo http://localhost:8000
echo.
python -m http.server 8000
pause
