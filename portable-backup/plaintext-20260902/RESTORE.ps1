param(
  [Parameter(Mandatory = $true)]
  [string]$TargetPath
)

$ErrorActionPreference = "Stop"

$snapshotDir = $PSScriptRoot
$firstVolume = Join-Path $snapshotDir "AVA-plaintext-git-20260902.7z.001"
$chunkManifest = Join-Path $snapshotDir "SHA256SUMS.txt"
$innerManifest = Join-Path $snapshotDir "INNER-SHA256SUMS.txt"
$innerName = "AVA-plaintext-current-20260902-v2.7z"
$supplementName = "AVA-plaintext-nested-git-20260902.7z"
$sevenZip = "C:\Program Files\7-Zip\7z.exe"

if (-not (Test-Path -LiteralPath $sevenZip)) {
  $sevenZipCommand = Get-Command 7z.exe -ErrorAction SilentlyContinue
  if (-not $sevenZipCommand) {
    throw "7-Zip is required. Install it from https://www.7-zip.org/."
  }
  $sevenZip = $sevenZipCommand.Source
}

if (-not (Test-Path -LiteralPath $TargetPath)) {
  throw "TargetPath must be an existing clone of AVA."
}

$target = (Resolve-Path -LiteralPath $TargetPath).Path
$targetRoot = [System.IO.Path]::GetPathRoot($target)
$targetParent = Split-Path -Parent $target
$targetLeaf = Split-Path -Leaf $target

if ($target -eq $targetRoot -or -not $targetParent -or $targetLeaf -ne "AVA") {
  throw "TargetPath must be a specific folder named AVA, not a drive or broad directory."
}
if (-not (Test-Path -LiteralPath (Join-Path $target ".git"))) {
  throw "TargetPath must be a Git clone with an existing .git directory."
}

try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/health" -TimeoutSec 2
  if ($health.ok) {
    throw "AVA is running. Stop AVA before restoring mutable databases and browser state."
  }
} catch {
  if ($_.Exception.Message -like "AVA is running.*") { throw }
}

foreach ($required in @($firstVolume, $chunkManifest, $innerManifest)) {
  if (-not (Test-Path -LiteralPath $required)) {
    throw "Backup file is missing: $required"
  }
}

function Test-Sha256Manifest([string]$ManifestPath, [string]$BasePath) {
  foreach ($line in Get-Content -LiteralPath $ManifestPath) {
    if (-not $line.Trim()) { continue }
    if ($line -notmatch '^([0-9A-Fa-f]{64})\s+\*?(.+)$') {
      throw "Malformed checksum line in $ManifestPath"
    }
    $expected = $matches[1].ToUpperInvariant()
    $name = $matches[2].Trim()
    $file = Join-Path $BasePath $name
    if (-not (Test-Path -LiteralPath $file)) {
      throw "Checksum target is missing: $file"
    }
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash
    if ($actual -ne $expected) {
      throw "Checksum mismatch: $name"
    }
  }
}

Write-Host "Verifying uploaded backup volumes..."
Test-Sha256Manifest -ManifestPath $chunkManifest -BasePath $snapshotDir

$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) (
  "ava-plaintext-restore-" + [guid]::NewGuid().ToString("N")
)
New-Item -ItemType Directory -Path $temporaryRoot | Out-Null

try {
  Write-Host "Extracting the verified wrapper..."
  & $sevenZip x $firstVolume "-o$temporaryRoot" -y
  if ($LASTEXITCODE -ne 0) { throw "Could not extract the backup wrapper." }

  $innerArchive = Join-Path $temporaryRoot $innerName
  $supplementArchive = Join-Path $temporaryRoot $supplementName
  if (-not (Test-Path -LiteralPath $innerArchive)) {
    throw "The wrapper did not contain $innerName."
  }
  if (-not (Test-Path -LiteralPath $supplementArchive)) {
    throw "The wrapper did not contain $supplementName."
  }

  Write-Host "Verifying the inner archive checksum and structure..."
  Test-Sha256Manifest -ManifestPath $innerManifest -BasePath $temporaryRoot
  & $sevenZip t $innerArchive
  if ($LASTEXITCODE -ne 0) { throw "The inner archive failed its integrity test." }
  & $sevenZip t $supplementArchive
  if ($LASTEXITCODE -ne 0) { throw "The nested Git supplement failed its integrity test." }

  Write-Host "Overlaying the captured AVA folder. The clone's .git is retained..."
  & $sevenZip x $innerArchive "-o$targetParent" -aoa -y
  if ($LASTEXITCODE -ne 0) { throw "The AVA data overlay failed." }
  & $sevenZip x $supplementArchive "-o$targetParent" -aoa -y
  if ($LASTEXITCODE -ne 0) { throw "The nested integration Git overlay failed." }

  if (-not (Test-Path -LiteralPath (Join-Path $target ".git"))) {
    throw "The clone's .git directory is unexpectedly missing after restore."
  }

  $metadataDir = Join-Path $targetParent "AVA-PLAINTEXT-METADATA-20260902"
  $bundle = Join-Path $metadataDir "AVA-git-nonbackup-refs-20260902-current.bundle"
  if (Test-Path -LiteralPath $bundle) {
    & git.exe -C $target bundle verify $bundle
    if ($LASTEXITCODE -ne 0) { throw "The included Git bundle failed verification." }
    & git.exe -C $target fetch $bundle "refs/heads/*:refs/heads/restored/*"
    if ($LASTEXITCODE -ne 0) { throw "The included Git refs could not be imported." }
  }

  Write-Host ""
  Write-Host "AVA portable data restored successfully."
  Write-Host "Next: npm.cmd ci; npm.cmd -w server run build; npm.cmd -w web run build; .\RUN-AVA.cmd"
} finally {
  if (Test-Path -LiteralPath $temporaryRoot) {
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
  }
}
