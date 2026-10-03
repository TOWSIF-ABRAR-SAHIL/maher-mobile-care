@echo off
setlocal EnableExtensions
title MAHER MOBILE CARE - Server

rem ---------------------------------------------------------------------------
rem  Starts the app server only, with no browser window.
rem
rem  Use this when the browser window does not open by itself, or to check
rem  whether the app is running. MAHER MOBILE CARE.bat is the normal way to
rem  open the shop.
rem ---------------------------------------------------------------------------

set "APP_HOME=%~dp0"
cd /d "%APP_HOME%"

set "NODE_EXE=%APP_HOME%runtime\node.exe"
set "SERVER_JS=%APP_HOME%app\server.js"
set "DATA_DIR=%APP_HOME%data"
set "BACKUP_DIR=%DATA_DIR%\backups"
set "LOG_FILE=%APP_HOME%logs\maher.log"
set "PORT=3000"

if not exist "%NODE_EXE%" (
  echo ERROR: runtime\node.exe not found. Copy the whole MAHER folder.
  pause
  exit /b 1
)

if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"
if not exist "%APP_HOME%logs" mkdir "%APP_HOME%logs%"

set "MAHER_DB_PATH=%DATA_DIR%\shop.db"
set "MAHER_BACKUP_DIR=%BACKUP_DIR%"
set "DATABASE_URL=file:%MAHER_DB_PATH%"
set "NODE_ENV=production"
set "PORT=%PORT%"
set "HOSTNAME=127.0.0.1"

echo Preparing the shop database ...
"%NODE_EXE%" "%APP_HOME%app\scripts\first-run.mjs"
if errorlevel 1 (
  echo.
  echo ERROR: the shop database could not be prepared.
  pause
  exit /b 1
)

echo.
echo MAHER MOBILE CARE is starting.
echo Open this address in your browser: http://127.0.0.1:%PORT%
echo.
echo Keep this window open while using the app.
echo To close the app, close this window.
echo.

rem Writes straight to the log while running. The previous version wrote to a
rem temporary file and only copied it afterwards, so nothing could be read while
rem the shop was failing - which is exactly when the log is needed.
echo Errors are saved to logs\maher.log
echo.
"%NODE_EXE%" "%SERVER_JS%" >>"%LOG_FILE%" 2>&1

echo.
echo The app has stopped. Last lines of the log:
powershell -NoProfile -Command "Get-Content -Tail 12 '%LOG_FILE%'" 2>nul
echo.
pause