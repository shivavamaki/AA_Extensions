@echo off
chcp 65001 > nul

:: pushd maps UNC paths (\\server\share) to a temporary drive letter automatically
pushd "%~dp0"

title BKN Knowledge Sharing Server
echo.
echo  Starting BKN Knowledge Sharing Server...
echo  Close this window to stop.
echo.

:: 1. Try 'py' launcher (installed with Python on Windows, recommended)
py --version > nul 2>&1
if %errorlevel% == 0 ( set PYTHON=py & goto :run )

:: 2. Try 'python' from PATH
python --version > nul 2>&1
if %errorlevel% == 0 ( set PYTHON=python & goto :run )

:: 3. Scan user-level install (no admin required location)
for /d %%D in ("%LocalAppData%\Programs\Python\Python3*") do (
  if exist "%%D\python.exe" ( set PYTHON=%%D\python.exe & goto :run )
)

:: 4. Scan system-level installs
for /d %%D in ("C:\Python3*") do (
  if exist "%%D\python.exe" ( set PYTHON=%%D\python.exe & goto :run )
)

echo  ERROR: Python not found.
echo.
echo  Install Python without admin rights — 2 options:
echo.
echo  Option A (easiest):
echo    Open Microsoft Store, search "Python 3.12", click Install.
echo.
echo  Option B (python.org):
echo    Go to https://www.python.org/downloads/
echo    Download the installer, run it, and CHECK the box
echo    "Add python.exe to PATH" before clicking Install Now.
echo.
echo  After installing, run this file again.
echo.
popd
pause
exit /b 1

:run
echo  Python : %PYTHON%
echo.
%PYTHON% "%~dp0bkn_ks_server.py" %*
echo.
popd
pause
