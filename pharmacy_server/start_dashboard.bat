@echo off
REM Launch the BKN Pharmacy Server desktop dashboard (Maprang).
REM Starts the server in-process and opens the GUI window — no terminal needed.
cd /d "%~dp0"

REM Prefer pythonw (no console window) for a clean desktop-app feel; fall back to python.
where pythonw >nul 2>&1
if %ERRORLEVEL%==0 (
    start "" pythonw "%~dp0maprang_app.py" %*
) else (
    start "" python "%~dp0maprang_app.py" %*
)
