param(
  [int]$Port = 9222,
  [string]$ExecutablePath = ""
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$profileDir = Join-Path $repoRoot "server\data\chrome-profile"
$focusScript = Join-Path $PSScriptRoot "focus-ava-browser.ps1"

$result = & $focusScript `
  -Port $Port `
  -ProfileDir $profileDir `
  -ExecutablePath $ExecutablePath `
  -StartIfMissing `
  -RestartIfInvisible |
  ConvertFrom-Json

if (-not $result.ok) {
  throw "Interactive AVA Chrome launch failed: $($result.reason)"
}
