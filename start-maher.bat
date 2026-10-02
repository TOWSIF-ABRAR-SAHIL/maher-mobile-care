@echo off
setlocal
cd /d "%~dp0"
echo MAHER MOBILE CARE chalu hocche...
if not exist .next (
  echo Prothombar production build hocche, ektu somoy lagbe...
  call npm run build
  if errorlevel 1 (
    echo Build fail koreche. Internet/Node check kore abar chalan.
    pause
    exit /b 1
  )
)
call npm start
pause
