@echo off
setlocal

set SCRIPT=%~dp0bkn_ks_server.py

echo.
echo  BKN Knowledge Sharing Server
echo  =============================
echo.

:: Try 'py' launcher (comes with Python installer on Windows)
py --version >nul 2>&1
if not errorlevel 1 (
  py "%SCRIPT%" %*
  goto :done
)

:: Try 'python' from PATH
python --version >nul 2>&1
if not errorlevel 1 (
  python "%SCRIPT%" %*
  goto :done
)

:: Try common user-level install paths (no admin required)
if exist "%LocalAppData%\Programs\Python\Python313\python.exe" (
  "%LocalAppData%\Programs\Python\Python313\python.exe" "%SCRIPT%" %*
  goto :done
)
if exist "%LocalAppData%\Programs\Python\Python312\python.exe" (
  "%LocalAppData%\Programs\Python\Python312\python.exe" "%SCRIPT%" %*
  goto :done
)
if exist "%LocalAppData%\Programs\Python\Python311\python.exe" (
  "%LocalAppData%\Programs\Python\Python311\python.exe" "%SCRIPT%" %*
  goto :done
)
if exist "%LocalAppData%\Programs\Python\Python310\python.exe" (
  "%LocalAppData%\Programs\Python\Python310\python.exe" "%SCRIPT%" %*
  goto :done
)

echo  Python not found.
echo.
echo  Install without admin rights:
echo  Open Microsoft Store and search "Python 3.12"
echo.

:done
endlocal
pause
