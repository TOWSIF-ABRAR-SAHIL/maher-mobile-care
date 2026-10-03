@echo off
setlocal EnableExtensions
title MAHER MOBILE CARE

rem ---------------------------------------------------------------------------
rem  MAHER MOBILE CARE - client launcher
rem
rem  Double-click this file. It prepares the shop database, starts the app and
rem  opens it in a Chrome-style app window (no address bar).
rem
rem  Nothing needs to be installed: Node is bundled in runtime\.
rem  The database lives in the data\ folder next to this file, so replacing the
rem  app files on an upgrade never touches the shop's records.
rem ---------------------------------------------------------------------------

set "APP_HOME=%~dp0"
rem /d also applies a drive change, which is what makes paths with spaces work.
cd /d "%APP_HOME%"

set "NODE_EXE=%APP_HOME%runtime\node.exe"
set "DATA_DIR=%APP_HOME%data"
set "BACKUP_DIR=%DATA_DIR%\backups"
set "LOG_FILE=%APP_HOME%logs\maher.log"
set "PORT=3000"

if not exist "%NODE_EXE%" (
  echo.
  echo   ERROR: runtime\node.exe was not found.
  echo   Please copy the whole MAHER folder. Do not move single files out of it.
  echo.
  pause
  exit /b 1
)

if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"
if not exist "%APP_HOME%logs" mkdir "%APP_HOME%logs%"

rem Keep every record in the data folder, never inside the app folder.
set "MAHER_DB_PATH=%DATA_DIR%\shop.db"
set "MAHER_BACKUP_DIR=%BACKUP_DIR%"
rem Prisma reads DATABASE_URL as a *file URL*, not a path, so a raw Windows path
rem such as D:\MAHER\data\shop.db is not a valid file URL. Convert the
rem backslashes and use the file:/// form that Node's fileURLToPath accepts.
rem (The data-load failure on the shop PC was a different, baked-path problem in
rem the server bundle, fixed in scripts/build-portable.mjs.)
set "MAHER_DB_URL=%MAHER_DB_PATH:\=/%"
set "DATABASE_URL=file:///%MAHER_DB_URL%"
set "NODE_ENV=production"
set "PORT=%PORT%"
set "HOSTNAME=127.0.0.1"

echo.
echo   MAHER MOBILE CARE
echo   ------------------

rem Create the database on first run. Safe to run every time.
"%NODE_EXE%" "%APP_HOME%app\scripts\first-run.mjs" >>"%LOG_FILE%" 2>&1
if errorlevel 1 (
  echo.
  echo   ERROR: The shop database could not be prepared.
  echo   Please send a photo of this window to MAHER support.
  echo.
  echo   --- last lines of the log ---
  powershell -NoProfile -Command "Get-Content -Tail 12 '%LOG_FILE%'" 2>nul
  echo.
  pause
  exit /b 1
)

rem scripts/launch.mjs starts the server, waits for it to be really ready, and
rem opens the shop window. It also refuses to start if another program is using
rem the same port, so the shop can never hijack an unrelated window.
"%NODE_EXE%" "%APP_HOME%app\scripts\launch.mjs"
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)

exit /b 0