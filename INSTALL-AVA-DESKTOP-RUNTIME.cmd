@echo off
setlocal
set "AVA_INSTALLER=%~dp0scripts\install-ava-desktop-runtime.ps1"
set "AVA_INSTALL_LOG=%~dp0server\data\desktop-runtime-install.log"
echo ==== %DATE% %TIME% ====>>"%AVA_INSTALL_LOG%"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%AVA_INSTALLER%" -SkipBuild >>"%AVA_INSTALL_LOG%" 2>&1
if errorlevel 1 (
  echo AVA desktop runtime installation did not complete. See "%AVA_INSTALL_LOG%".
  exit /b 1
)
echo AVA desktop runtime installation finished without Administrator approval.
endlocal
