@echo off
setlocal
set "APP=%~dp0extension_manager.py"
where py.exe >nul 2>&1
if not errorlevel 1 (
    py.exe -3 -c "import tkinter" >nul 2>&1
    if not errorlevel 1 (
        start "" pyw.exe -3 "%APP%"
        exit /b 0
    )
)
where python.exe >nul 2>&1
if not errorlevel 1 (
    python.exe -c "import tkinter" >nul 2>&1
    if not errorlevel 1 (
        where pythonw.exe >nul 2>&1
        if not errorlevel 1 (
            start "" pythonw.exe "%APP%"
            exit /b 0
        )
        python.exe "%APP%"
        exit /b 0
    )
)
echo Python 3 with Tkinter is required. No pip packages are needed.
echo Keep this launcher beside extension_manager.py and the PowerShell scripts.
echo If your Python is not on PATH, run extension_manager.py with that Python.
pause
exit /b 1
