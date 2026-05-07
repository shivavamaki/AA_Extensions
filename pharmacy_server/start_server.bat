@echo off
chcp 65001 > nul
title BKN Knowledge Sharing Server
echo.
echo  Starting BKN Knowledge Sharing Server...
echo  Close this window to stop the server.
echo.
python "%~dp0bkn_ks_server.py" %*
echo.
pause
