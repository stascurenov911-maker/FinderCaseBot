@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 pause & exit /b 1
)
if not exist .env (
  copy .env.example .env
  echo.
  echo .env created. Put BOT_TOKEN and WEBAPP_URL into it.
  echo.
)
call npm run dev
pause
