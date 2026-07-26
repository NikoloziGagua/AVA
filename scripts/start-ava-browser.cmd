@echo off
setlocal
set "AVA_BROWSER_QUIET="
if /I "%~1"=="/quiet" set "AVA_BROWSER_QUIET=1"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-ava-browser.ps1"
if errorlevel 1 (
  echo.
  echo AVA Chrome did not start. Keep this window open and send the error to AVA support.
  if not defined AVA_BROWSER_QUIET pause
  exit /b 1
)
endlocal
