$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$runtime = Join-Path $PSScriptRoot "start-ava-desktop-runtime.ps1"
$powershell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"

if (-not (Test-Path -LiteralPath $runtime -PathType Leaf)) {
  throw "AVA desktop runtime launcher is missing: $runtime"
}

$arguments = '-NoLogo -NoProfile -ExecutionPolicy Bypass -File "' + $runtime + '"'
Start-Process `
  -FilePath $powershell `
  -Verb RunAs `
  -ArgumentList $arguments `
  -WorkingDirectory $repoRoot
