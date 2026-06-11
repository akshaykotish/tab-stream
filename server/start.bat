@echo off
REM Tab Stream server launcher (Windows)
cd /d "%~dp0"
where node >/dev/null 2>/dev/null
if errorlevel 1 (
  echo Node.js is required. Install it from https://nodejs.org then run this again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies (first run only)...
  call npm install || exit /b 1
)
echo Starting Tab Stream...
node server.js
pause
