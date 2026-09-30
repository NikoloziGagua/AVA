@echo off
setlocal
title Run AVA as Administrator
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\request-ava-admin.ps1"
if errorlevel 1 (
  echo.
  echo AVA was not elevated. Approve the Windows UAC prompt and try again.
  pause
  exit /b 1
)
endlocal
