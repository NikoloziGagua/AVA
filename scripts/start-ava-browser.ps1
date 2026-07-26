param(
  [int]$Port = 9222,
  [string]$ExecutablePath = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$profileDir = Join-Path $repoRoot "server\data\chrome-profile"
$focusScript = Join-Path $PSScriptRoot "focus-ava-browser.ps1"
$interactiveStarter = Join-Path $PSScriptRoot "start-ava-browser-on-default.ps1"
$desktopBroker = Join-Path $PSScriptRoot "invoke-on-default-desktop.ps1"

. $desktopBroker

# If AVA Chrome already exists on the real user desktop, simply foreground it.
$existing = & $focusScript `
  -Port $Port `
  -ProfileDir $profileDir `
  -ExecutablePath $ExecutablePath |
  ConvertFrom-Json
if ($existing.ok) {
  Write-Host "AVA Chrome is ready on the owner's visible Default desktop."
  exit 0
}

if ((Get-AvaCurrentDesktop) -eq "Default") {
  & $interactiveStarter -Port $Port -ExecutablePath $ExecutablePath
  if ($LASTEXITCODE -ne 0) {
    throw "The interactive AVA Chrome launcher failed."
  }
} else {
  # This process is on CodexSandboxDesktop-*. Ask the real Explorer Run dialog
  # on Default to execute the fixed local starter under the owner's interactive
  # token. No elevation, UAC, or approval is involved.
  $arguments =
    "-NoLogo -NoProfile -ExecutionPolicy Bypass " +
    "-WindowStyle Hidden -File `"$interactiveStarter`" -Port $Port"
  if ($ExecutablePath) {
    $arguments += " -ExecutablePath `"$ExecutablePath`""
  }
  Invoke-OnDefaultDesktop `
    -FilePath "powershell.exe" `
    -Arguments $arguments `
    -WorkingDirectory $repoRoot `
    -WindowStyle 0
}

$deadline = (Get-Date).AddSeconds(35)
do {
  Start-Sleep -Milliseconds 300
  $verified = & $focusScript `
    -Port $Port `
    -ProfileDir $profileDir `
    -ExecutablePath $ExecutablePath |
    ConvertFrom-Json
} while (-not $verified.ok -and (Get-Date) -lt $deadline)

if (-not $verified.ok) {
  throw "AVA Chrome did not become visible on WinSta0\Default: $($verified.reason)"
}

Write-Host "AVA Chrome is ready on the owner's visible Default desktop."
Write-Host "Log into Instagram, WhatsApp Web, Gmail, Calendar, and other services in this dedicated window once; those sessions persist locally."
