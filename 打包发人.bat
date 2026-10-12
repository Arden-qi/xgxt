@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 18 or later is required. Install it from https://nodejs.org
  pause
  exit /b 1
)
node tools\package-release.mjs
set "RESULT=%errorlevel%"
if not "%RESULT%"=="0" pause
exit /b %RESULT%
