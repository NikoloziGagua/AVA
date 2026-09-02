param(
  [string]$DestinationRoot = "C:\Users\nikug\ai",
  [string]$SevenZip = "C:\Program Files\7-Zip\7z.exe"
)

$ErrorActionPreference = "Stop"
$backupDir = $PSScriptRoot
$destination = [IO.Path]::GetFullPath($DestinationRoot)
$avaPath = [IO.Path]::GetFullPath((Join-Path $destination "AVA"))
$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$tempRestore = [IO.Path]::GetFullPath((Join-Path $tempBase ("ava-restore-" + [guid]::NewGuid().ToString("N"))))

if (-not (Test-Path -LiteralPath $SevenZip)) {
  throw "7-Zip was not found at $SevenZip"
}
if (Test-Path -LiteralPath $avaPath) {
  throw "Refusing to overlay an existing AVA directory: $avaPath"
}

function Assert-Checksums {
  param([string]$Manifest, [string]$FilesRoot)
  foreach ($line in Get-Content -LiteralPath $Manifest) {
    if (-not $line.Trim()) { continue }
    if ($line -notmatch '^([A-Fa-f0-9]{64})\s+\*?(.+)$') {
      throw "Malformed checksum line in $Manifest"
    }
    $expected = $matches[1].ToUpperInvariant()
    $file = Join-Path $FilesRoot $matches[2]
    if (-not (Test-Path -LiteralPath $file)) {
      throw "Backup file is missing: $file"
    }
    $actual = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
    if ($actual -ne $expected) {
      throw "Checksum mismatch: $file"
    }
  }
}

$secureKey = Read-Host "Enter the separately stored AVA backup key" -AsSecureString
$keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try {
  $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
}

try {
  Assert-Checksums (Join-Path $backupDir "SHA256SUMS.txt") $backupDir
  Assert-Checksums (Join-Path $backupDir "REFRESH-20260902-SHA256SUMS.txt") $backupDir

  New-Item -ItemType Directory -Path $tempRestore | Out-Null
  & $SevenZip x (Join-Path $backupDir "AVA-full-20260830-upload.7z.001") ("-o" + $tempRestore) -y
  if ($LASTEXITCODE -ne 0) { throw "Failed to reconstruct the encrypted baseline volumes." }
  Assert-Checksums (Join-Path $backupDir "INNER-SHA256SUMS.txt") $tempRestore

  New-Item -ItemType Directory -Path $destination -Force | Out-Null
  & $SevenZip x (Join-Path $tempRestore "AVA-full-20260830.7z.001") ("-p" + $plainKey) ("-o" + $destination) -y
  if ($LASTEXITCODE -ne 0) { throw "Failed to extract the encrypted baseline." }
  & $SevenZip x (Join-Path $backupDir "AVA-cumulative-delta-20260902.7z") ("-p" + $plainKey) ("-o" + $avaPath) -aoa -y
  if ($LASTEXITCODE -ne 0) { throw "Failed to overlay the encrypted current-state refresh." }

  $metadata = [IO.Path]::GetFullPath((Join-Path $avaPath ".ava-backup-metadata"))
  $deletionManifest = Join-Path $metadata "deleted-since-baseline-20260902.txt"
  foreach ($relative in Get-Content -LiteralPath $deletionManifest) {
    if (-not $relative.Trim() -or [IO.Path]::IsPathRooted($relative)) { continue }
    $target = [IO.Path]::GetFullPath((Join-Path $avaPath $relative))
    if (-not $target.StartsWith($avaPath + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Deletion manifest escaped the restored AVA root: $relative"
    }
    if (Test-Path -LiteralPath $target) {
      Remove-Item -LiteralPath $target -Force
    }
  }

  $git = (Get-Command git.exe -ErrorAction Stop).Source
  $bundle = Join-Path $metadata "AVA-git-nonbackup-refs-20260902.bundle"
  & $git -C $avaPath fetch $bundle '+refs/heads/*:refs/remotes/backup-refresh/*'
  if ($LASTEXITCODE -ne 0) { throw "Failed to import the encrypted local Git history bundle." }

  if (-not $metadata.StartsWith($avaPath + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing unsafe metadata cleanup path: $metadata"
  }
  Remove-Item -LiteralPath $metadata -Recurse -Force
  Write-Host "AVA restore completed at $avaPath"
} finally {
  $plainKey = $null
  if ($tempRestore.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $tempRestore)) {
    Remove-Item -LiteralPath $tempRestore -Recurse -Force
  }
}
