$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$sourceDir = Join-Path $repoRoot "server\data\activepieces-source"
$patchFile = Join-Path $repoRoot "integrations\activepieces\windows-esm-loader.patch"
$runtimeLauncher = Join-Path $PSScriptRoot "start-activepieces-runtime.ps1"
$expectedCommit = "217380c40e2a3c138cbf461b6f4bd442e3decf2b"
$officialRemote = "https://github.com/activepieces/activepieces.git"

function Set-EnvValue([string]$Path, [string]$Name, [string]$Value) {
  $lines = if (Test-Path -LiteralPath $Path) { @(Get-Content -LiteralPath $Path) } else { @() }
  $replacement = "$Name=$Value"
  $matched = $false
  $updated = foreach ($line in $lines) {
    if ($line -match "^$([regex]::Escape($Name))=") {
      if (-not $matched) { $replacement }
      $matched = $true
    } else {
      $line
    }
  }
  if (-not $matched) { $updated += $replacement }
  Set-Content -LiteralPath $Path -Value $updated -Encoding utf8
}

if (-not (Test-Path -LiteralPath (Join-Path $sourceDir ".git"))) {
  New-Item -ItemType Directory -Path (Split-Path $sourceDir -Parent) -Force | Out-Null
  & git.exe clone --filter=blob:none $officialRemote $sourceDir
  if ($LASTEXITCODE -ne 0) { throw "Could not clone the official Activepieces repository." }
  & git.exe -C $sourceDir checkout --detach $expectedCommit
  if ($LASTEXITCODE -ne 0) { throw "Could not check out pinned Activepieces commit $expectedCommit." }
}

$origin = (& git.exe -C $sourceDir remote get-url origin).Trim()
$actualCommit = (& git.exe -C $sourceDir rev-parse HEAD).Trim()
if ($origin -ne $officialRemote -or $actualCommit -ne $expectedCommit) {
  throw "Refusing an untrusted or unpinned Activepieces checkout. Origin='$origin', commit='$actualCommit'."
}

$reverseCheck = & git.exe -C $sourceDir apply --reverse --check $patchFile 2>&1
if ($LASTEXITCODE -ne 0) {
  & git.exe -C $sourceDir apply --check $patchFile
  if ($LASTEXITCODE -ne 0) { throw "The pinned Windows ESM compatibility patch no longer applies cleanly." }
  & git.exe -C $sourceDir apply $patchFile
  if ($LASTEXITCODE -ne 0) { throw "Could not apply the Windows ESM compatibility patch." }
}

Push-Location $sourceDir
try {
  & node.exe "tools\setup-dev.js"
  if ($LASTEXITCODE -ne 0) { throw "The official Activepieces development setup failed." }
} finally {
  Pop-Location
}

$activepiecesEnv = Join-Path $sourceDir ".env.dev"
Set-EnvValue $activepiecesEnv "AP_ENVIRONMENT" '"prod"'
Set-EnvValue $activepiecesEnv "AP_DEV_PIECES" '"google-sheets,store,webhook"'
Set-EnvValue $activepiecesEnv "AP_QUEUE_MODE" "MEMORY"
Set-EnvValue $activepiecesEnv "AP_DB_TYPE" "PGLITE"
Set-EnvValue $activepiecesEnv "AP_TELEMETRY_ENABLED" "false"

& powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $runtimeLauncher -Force
if ($LASTEXITCODE -ne 0) { throw "Activepieces installed but did not start." }

Push-Location $repoRoot
try {
  & npm.cmd -w server run setup:activepieces
  if ($LASTEXITCODE -ne 0) { throw "The pinned AVA playbook flows could not be provisioned." }
} finally {
  Pop-Location
}

Write-Output "Genuine Activepieces runtime and AVA pinned playbook flows are installed and configured."
