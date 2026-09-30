@echo off
setlocal
title AVA
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-ava-desktop-runtime.ps1"
set "AVA_EXIT=%ERRORLEVEL%"
if not "%AVA_EXIT%"=="0" (
  echo.
  echo AVA failed to start. Exit code: %AVA_EXIT%
  pause
  exit /b %AVA_EXIT%
)
endlocal
