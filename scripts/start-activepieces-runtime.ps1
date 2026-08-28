param(
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$sourceDir = Join-Path $repoRoot "server\data\activepieces-source"
$packageFile = Join-Path $sourceDir "package.json"
$rootEnv = Join-Path $repoRoot ".env"
$logDir = Join-Path $repoRoot "logs"
$stdoutLog = Join-Path $logDir "activepieces-runtime.log"
$stderrLog = Join-Path $logDir "activepieces-runtime-error.log"
$expectedCommit = "217380c40e2a3c138cbf461b6f4bd442e3decf2b"

function Test-ActivepiecesReady {
  try {
    $flags = Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/v1/flags" -TimeoutSec 3
    return $null -ne $flags -and $null -ne $flags.ENVIRONMENT
  } catch {
    return $false
  }
}

if (Test-ActivepiecesReady) {
  Write-Output "Activepieces is already ready on http://127.0.0.1:3000."
  exit 0
}

$enabled = $false
if (Test-Path -LiteralPath $rootEnv) {
  $enabled = [bool](Select-String -LiteralPath $rootEnv -Pattern '^ACTIVEPIECES_ENABLED\s*=\s*true\s*$' -CaseSensitive:$false)
}
if (-not $Force -and -not $enabled) {
  Write-Output "Activepieces is disabled in AVA's local .env; runtime start skipped."
  exit 0
}

if (-not (Test-Path -LiteralPath $packageFile)) {
  throw "The pinned Activepieces runtime is not installed. Run scripts\setup-activepieces-runtime.ps1 first."
}

$actualCommit = (& git.exe -C $sourceDir rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $actualCommit -ne $expectedCommit) {
  throw "Activepieces source identity mismatch. Expected $expectedCommit, got '$actualCommit'."
}

$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

# The official source runtime supplies the real API, engine, worker and local UI.
# It is hidden because AVA owns the user-facing control surface. Logs remain local
# and ignored; AVA sends only its bounded sanitized workflow contract.
[void](Start-Process `
  -FilePath $npm `
  -ArgumentList @("run", "dev") `
  -WorkingDirectory $sourceDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog `
  -PassThru)

$deadline = (Get-Date).AddMinutes(3)
do {
  Start-Sleep -Milliseconds 750
} while (-not (Test-ActivepiecesReady) -and (Get-Date) -lt $deadline)

if (-not (Test-ActivepiecesReady)) {
  $tail = if (Test-Path -LiteralPath $stderrLog) {
    (Get-Content -LiteralPath $stderrLog -Tail 12) -join [Environment]::NewLine
  } else {
    "No stderr log was produced."
  }
  throw "Activepieces did not become ready within three minutes. Recent stderr:`n$tail"
}

Write-Output "Activepieces is ready on http://127.0.0.1:3000."
