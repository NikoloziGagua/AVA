param(
  [switch]$Force,

  [ValidateRange(1, 5)]
  [int]$MaxAttempts = 3
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$sourceDir = Join-Path $repoRoot "server\data\activepieces-source"
$packageFile = Join-Path $sourceDir "package.json"
$rootEnv = Join-Path $repoRoot ".env"
$logDir = Join-Path $repoRoot "logs"
$stdoutLog = Join-Path $logDir "activepieces-runtime.log"
$stderrLog = Join-Path $logDir "activepieces-runtime-error.log"
$policyModule = Join-Path $PSScriptRoot "activepieces-runtime-policy.psm1"
$expectedCommit = "217380c40e2a3c138cbf461b6f4bd442e3decf2b"

Import-Module $policyModule -Force

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
#
# On this Windows host, App Control inspection has occasionally rejected one of
# Bun/esbuild's first concurrent child-process launches with EPERM or Bun's
# unhelpful "unknown error". Those failures are transient: the same pinned build
# succeeds immediately afterward. Retry only that evidence-backed failure class;
# configuration, source-identity and ordinary compiler errors still fail closed.
$lastEvidence = "No runtime output was produced."
for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
  if (Test-ActivepiecesReady) {
    break
  }

  [System.IO.File]::WriteAllText($stdoutLog, "")
  [System.IO.File]::WriteAllText($stderrLog, "")

  $runtimeProcess = Start-Process `
    -FilePath $npm `
    -ArgumentList @("run", "dev") `
    -WorkingDirectory $sourceDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -PassThru

  $deadline = (Get-Date).AddMinutes(3)
  do {
    Start-Sleep -Milliseconds 750
    $runtimeProcess.Refresh()
  } while (
    -not (Test-ActivepiecesReady) -and
    -not $runtimeProcess.HasExited -and
    (Get-Date) -lt $deadline
  )

  if (Test-ActivepiecesReady) {
    break
  }

  $lastEvidence = Get-ActivepiecesLaunchEvidence `
    -StdoutPath $stdoutLog `
    -StderrPath $stderrLog

  if (-not $runtimeProcess.HasExited) {
    & taskkill.exe /PID $runtimeProcess.Id /T /F *> $null
  }

  $isTransient = Test-ActivepiecesTransientLaunchFailure -Output $lastEvidence
  if (-not $isTransient -or $attempt -eq $MaxAttempts) {
    $exitDetail = if ($runtimeProcess.HasExited) {
      "Runtime process exited with code $($runtimeProcess.ExitCode)."
    } else {
      "Runtime process did not become ready before the startup deadline."
    }
    throw "Activepieces did not become ready on attempt $attempt/$MaxAttempts. $exitDetail`n$lastEvidence"
  }

  Write-Warning "Activepieces hit a transient Windows process-launch failure on attempt $attempt/$MaxAttempts; retrying the same pinned runtime."
  Start-Sleep -Seconds ([Math]::Min(2 * $attempt, 5))
}

if (-not (Test-ActivepiecesReady)) {
  throw "Activepieces exhausted $MaxAttempts startup attempts without becoming ready.`n$lastEvidence"
}

Write-Output "Activepieces is ready on http://127.0.0.1:3000."
