# Run from a normal PowerShell. No Administrator rights or UAC are required.
# Builds AVA and installs an interactive per-user Windows runtime.
$ErrorActionPreference = "Stop"

Push-Location $PSScriptRoot\..

$rootEnv = Join-Path (Get-Location) ".env"
$serverEnv = Join-Path (Get-Location) "server\.env"
if (-not (Test-Path -LiteralPath $rootEnv) -and -not (Test-Path -LiteralPath $serverEnv)) {
  Write-Warning "No .env file found. AVA will start, but chat is disabled until OPENAI_API_KEY or ANTHROPIC_API_KEY is configured."
}

& (Join-Path $PSScriptRoot "install-ava-desktop-runtime.ps1")

Write-Host "Ava is configured for the signed-in Windows desktop. Visit http://localhost:8787/_status"
Pop-Location
