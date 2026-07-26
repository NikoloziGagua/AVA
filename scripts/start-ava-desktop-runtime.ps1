$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$serverDir = Join-Path $repoRoot "server"
$serverEntry = Join-Path $serverDir "dist\index.js"
$browserLauncher = Join-Path $PSScriptRoot "start-ava-browser.ps1"
$inputDesktopLauncher = Join-Path $PSScriptRoot "start-on-input-desktop.ps1"
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source

. $inputDesktopLauncher

# Establish a verified visible browser before the server can accept commands.
# The browser launcher uses Windows ShellExecute(show=normal), so the parent
# PowerShell can remain hidden without hiding Chrome. Running synchronously also
# prevents the installer from mistaking a stale background endpoint for success.
& powershell.exe `
  -NoLogo `
  -NoProfile `
  -ExecutionPolicy Bypass `
  -File $browserLauncher
if ($LASTEXITCODE -ne 0) {
  throw "AVA Chrome launcher failed with exit code $LASTEXITCODE."
}

# Keep exactly one AVA server. At login there is normally no listener; if the
# server is already healthy, leave it alone and only ensure Chrome is awake.
$alreadyRunning = $false
try {
  $alreadyRunning = [bool](Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/health" -TimeoutSec 2).ok
} catch {
  $alreadyRunning = $false
}
if (-not $alreadyRunning) {
  [void](Start-OnInputDesktop `
    -FilePath $nodePath `
    -ArgumentList @($serverEntry) `
    -WorkingDirectory $serverDir `
    -NoWindow)
}
