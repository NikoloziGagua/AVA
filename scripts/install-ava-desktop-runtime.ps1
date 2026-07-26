param(
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$serverEntry = Join-Path $repoRoot "server\dist\index.js"
$desktopStarter = Join-Path $PSScriptRoot "start-ava-desktop-runtime.ps1"
$focusScript = Join-Path $PSScriptRoot "focus-ava-browser.ps1"
$desktopBroker = Join-Path $PSScriptRoot "invoke-on-default-desktop.ps1"
$profileDir = Join-Path $repoRoot "server\data\chrome-profile"

. $desktopBroker
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$runName = "AVA Desktop Runtime"

if (-not $SkipBuild) {
  Push-Location $repoRoot
  try {
    npm.cmd -w server run build
    if ($LASTEXITCODE -ne 0) {
      throw "AVA server build failed with exit code $LASTEXITCODE."
    }
    npm.cmd -w web run build
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "The normal web build failed; using AVA's managed Windows build fallback."
      npm.cmd -w web run build:managed
      if ($LASTEXITCODE -ne 0) {
        throw "AVA web build failed with exit code $LASTEXITCODE."
      }
    }
  } finally {
    Pop-Location
  }
}

if (-not (Test-Path -LiteralPath $serverEntry)) {
  throw "AVA server build is missing: $serverEntry"
}
if (-not (Test-Path -LiteralPath $desktopStarter)) {
  throw "AVA desktop starter is missing: $desktopStarter"
}

# Stop only a listener that answers as AVA. This replaces the restricted
# Codex-launched process without touching unrelated Node applications.
$listenerLines = netstat -ano -p tcp |
  Select-String "127\.0\.0\.1:8787\s+0\.0\.0\.0:0\s+LISTENING"
foreach ($line in $listenerLines) {
  $parts = $line.ToString().Trim() -split "\s+"
  $listenerPid = [int]$parts[-1]
  $isAva = $false
  try {
    $isAva = [bool](Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/health" -TimeoutSec 2).ok
  } catch {
    $isAva = $false
  }
  if ($isAva) {
    Stop-Process -Id $listenerPid -Force
  }
}

# HKCU Run is scoped to the signed-in owner and requires neither Administrator
# rights nor UAC. Explorer starts this PowerShell script at login, so AVA does
# not inherit a developer sandbox or a Windows service's non-interactive session.
New-Item -Path $runKey -Force | Out-Null
$runCommand =
  "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$desktopStarter`""
New-ItemProperty `
  -Path $runKey `
  -Name $runName `
  -Value $runCommand `
  -PropertyType String `
  -Force | Out-Null

$starterArguments =
  "-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden " +
  "-File `"$desktopStarter`""
Invoke-OnDefaultDesktop `
  -FilePath "powershell.exe" `
  -Arguments $starterArguments `
  -WorkingDirectory $repoRoot `
  -WindowStyle 0

$health = $null
$browserReady = $false
$deadline = (Get-Date).AddSeconds(40)
do {
  Start-Sleep -Milliseconds 500
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/health" -TimeoutSec 2
  } catch {
    $health = $null
  }
  try {
    $browser = Invoke-RestMethod -Uri "http://127.0.0.1:9222/json/version" -TimeoutSec 2
    $browserReady = [bool]$browser.webSocketDebuggerUrl
  } catch {
    $browserReady = $false
  }
} while ((-not $health.ready -or -not $browserReady) -and (Get-Date) -lt $deadline)

if (-not $health.ready) {
  throw "AVA Desktop Runtime did not become healthy."
}
if (-not $browserReady) {
  throw "AVA is healthy, but the persistent Chrome endpoint did not become ready."
}

$window = & $focusScript -Port 9222 -ProfileDir $profileDir | ConvertFrom-Json
if (-not $window.ok -or -not $window.visible) {
  throw "AVA Chrome endpoint is ready, but its desktop window is not visible: $($window.reason)"
}

Write-Host ""
Write-Host "AVA Desktop Runtime is installed without Administrator rights or UAC."
Write-Host "AVA and her persistent logged-in Chrome are ready and visible."
