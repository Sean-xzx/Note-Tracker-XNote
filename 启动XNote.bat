@echo off
rem Portable launcher. Install dependencies and rebuild native modules first.
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Run npm ci and npm run rebuild first.
  pause
  exit /b 1
)
if not exist "out\main\index.js" (
  call npm run build
  if errorlevel 1 exit /b 1
)
set ELECTRON_RUN_AS_NODE=
start "XNote" "node_modules\electron\dist\electron.exe" .
