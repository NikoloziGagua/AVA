$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$serverDir = Join-Path $repoRoot "server"
$serverEntry = Join-Path $serverDir "dist\index.js"
$buildIdFile = Join-Path $serverDir "dist\build-id.txt"
$browserLauncher = Join-Path $PSScriptRoot "start-ava-browser.ps1"
$activepiecesLauncher = Join-Path $PSScriptRoot "start-activepieces-runtime.ps1"
$inputDesktopLauncher = Join-Path $PSScriptRoot "start-on-input-desktop.ps1"
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source

. $inputDesktopLauncher

if (-not (Test-Path -LiteralPath $buildIdFile)) {
  throw "AVA build identity is missing. Run npm.cmd -w server run build first: $buildIdFile"
}
$desiredBuildId = (Get-Content -LiteralPath $buildIdFile -Raw).Trim()
if (-not $desiredBuildId) {
  throw "AVA build identity is empty: $buildIdFile"
}

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

# A configured pinned automation is part of the local AVA runtime. Start its
# genuine engine/worker before AVA begins accepting work; keep AVA usable if an
# optional automation dependency fails, because the invocation then reports its
# own honest unavailable/unreachable result.
try {
  & powershell.exe `
    -NoLogo `
    -NoProfile `
    -ExecutionPolicy Bypass `
    -File $activepiecesLauncher
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "Activepieces launcher exited with code $LASTEXITCODE."
  }
} catch {
  Write-Warning "Activepieces did not start: $($_.Exception.Message)"
}

# Keep exactly one AVA server. Liveness is insufficient: a process started
# before the latest build can be healthy while still executing removed code.
# Leave the listener alone only when it reports the exact installed build ID.
$alreadyRunning = $false
$runningHealth = $null
try {
  $runningHealth = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/health" -TimeoutSec 2
  $alreadyRunning = [bool]$runningHealth.ok -and $runningHealth.buildId -eq $desiredBuildId
} catch {
  $alreadyRunning = $false
}

if ($runningHealth -and $runningHealth.ok -and -not $alreadyRunning) {
  # The endpoint identified itself as AVA, but it is not this build. Resolve
  # and stop only the loopback listener that answered that health request.
  $listenerLines = netstat -ano -p tcp |
    Select-String "127\.0\.0\.1:8787\s+0\.0\.0\.0:0\s+LISTENING"
  if (-not $listenerLines) {
    throw "AVA reported stale build '$($runningHealth.buildId)' but its listener PID could not be resolved."
  }
  foreach ($line in $listenerLines) {
    $parts = $line.ToString().Trim() -split "\s+"
    Stop-Process -Id ([int]$parts[-1]) -Force
  }
  $releaseDeadline = (Get-Date).AddSeconds(10)
  do {
    Start-Sleep -Milliseconds 250
    $remaining = netstat -ano -p tcp |
      Select-String "127\.0\.0\.1:8787\s+0\.0\.0\.0:0\s+LISTENING"
  } while ($remaining -and (Get-Date) -lt $releaseDeadline)
  if ($remaining) {
    throw "The stale AVA listener did not release port 8787."
  }
}

if (-not $alreadyRunning) {
  [void](Start-OnInputDesktop `
    -FilePath $nodePath `
    -ArgumentList @($serverEntry) `
    -WorkingDirectory $serverDir `
    -NoWindow)
}

$confirmedHealth = $null
$healthDeadline = (Get-Date).AddSeconds(30)
do {
  Start-Sleep -Milliseconds 500
  try {
    $confirmedHealth = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/health" -TimeoutSec 2
  } catch {
    $confirmedHealth = $null
  }
} while (
  (-not $confirmedHealth -or $confirmedHealth.buildId -ne $desiredBuildId) -and
  (Get-Date) -lt $healthDeadline
)

if (-not $confirmedHealth -or $confirmedHealth.buildId -ne $desiredBuildId) {
  $actual = if ($confirmedHealth) { $confirmedHealth.buildId } else { "no healthy listener" }
  throw "AVA runtime freshness check failed: expected build '$desiredBuildId', got '$actual'."
}
