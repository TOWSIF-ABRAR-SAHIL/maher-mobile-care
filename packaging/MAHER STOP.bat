@echo off
setlocal EnableExtensions
title MAHER MOBILE CARE - Stop

rem ---------------------------------------------------------------------------
rem  Stops MAHER MOBILE CARE on this PC.
rem
rem  Use this when the shop will not open, or after the PC has been switched off
rem  without closing MAHER. It only stops a server that answers as MAHER on the
rem  port this folder uses; it never touches an unrelated program.
rem ---------------------------------------------------------------------------

set "APP_HOME=%~dp0"
cd /d "%APP_HOME%"

set "NODE_EXE=%APP_HOME%runtime\node.exe"
set "PORT=3000"

if not exist "%NODE_EXE%" (
  echo ERROR: runtime\node.exe not found. Copy the whole MAHER folder.
  pause
  exit /b 1
)

echo.
echo   Stopping MAHER MOBILE CARE ...
echo.
"%NODE_EXE%" "%APP_HOME%app\scripts\launch.mjs" --stop
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)

echo.
pause
exit /b 0