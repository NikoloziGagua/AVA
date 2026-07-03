# Run this ON THE OLD COMPUTER (the one with user profile "nikug").
# It gathers everything the new machine needs into one zip on the Desktop:
#   1. A full git bundle (heals the corrupted objects on the new machine)
#   2. server\data\  — Ava's chats, memory, approvals, rules (the real state)
#   3. root data\    — whatever secondary state exists
#   4. .env files    — API keys + web-push VAPID keys
#   5. Claude Code transcripts for this project (~\.claude\projects\*yovlisshemdzle*)
#
# Usage:  powershell -ExecutionPolicy Bypass -File collect-old-machine-data.ps1
#         (optionally:  -RepoPath "C:\path\to\yovlisshemdzle")
# Compatible with Windows PowerShell 5.1.

param([string]$RepoPath = "")

$ErrorActionPreference = "Continue"
$out = Join-Path ([Environment]::GetFolderPath("Desktop")) "ava-recovery"
New-Item -ItemType Directory -Force -Path $out | Out-Null
$report = @()

# ── Locate the repo ──────────────────────────────────────────────────────────
if (-not $RepoPath) {
  $candidates = @()
  foreach ($root in @("$env:USERPROFILE\Desktop", "$env:USERPROFILE", "C:\ai", "C:\projects")) {
    if (Test-Path (Join-Path $root "yovlisshemdzle\.git")) { $candidates += (Join-Path $root "yovlisshemdzle") }
  }
  if ($candidates.Count -eq 0) {
    Write-Host "Could not find the yovlisshemdzle repo automatically." -ForegroundColor Red
    Write-Host "Re-run with:  -RepoPath 'C:\path\to\yovlisshemdzle'" -ForegroundColor Yellow
    exit 1
  }
  $RepoPath = $candidates[0]
}
Write-Host "Repo: $RepoPath" -ForegroundColor Cyan
$report += "repo: $RepoPath"

# ── Stop the running server so the SQLite DB is quiescent ────────────────────
try { pm2 stop ava 2>$null | Out-Null; $report += "pm2 stop ava: attempted" } catch { $report += "pm2 not present (fine)" }

# ── 1. Full git bundle ───────────────────────────────────────────────────────
Push-Location $RepoPath
git bundle create (Join-Path $out "ava-full.bundle") --all
if ($LASTEXITCODE -eq 0) {
  git bundle verify (Join-Path $out "ava-full.bundle")
  $report += "git bundle: OK ($( (Get-Item (Join-Path $out 'ava-full.bundle')).Length ) bytes)"
} else {
  $report += "git bundle: FAILED — tell Claude on the new machine"
}
Pop-Location

# ── 2 + 3. Data directories ──────────────────────────────────────────────────
foreach ($pair in @(@("server\data", "server-data"), @("data", "root-data"))) {
  $src = Join-Path $RepoPath $pair[0]
  if (Test-Path $src) {
    robocopy $src (Join-Path $out $pair[1]) /E /R:2 /W:2 /NFL /NDL /NJH | Out-Null
    $n = (Get-ChildItem -Recurse (Join-Path $out $pair[1]) | Measure-Object).Count
    $report += "$($pair[0]): copied ($n items)"
  } else {
    $report += "$($pair[0]): NOT FOUND"
  }
}

# ── 4. Env files ─────────────────────────────────────────────────────────────
foreach ($envRel in @(".env", "server\.env", "web\.env")) {
  $src = Join-Path $RepoPath $envRel
  if (Test-Path $src) {
    $dest = Join-Path $out ("env-files\" + ($envRel -replace "\\", "__"))
    New-Item -ItemType Directory -Force -Path (Split-Path $dest) | Out-Null
    Copy-Item $src $dest
    $report += "$envRel : copied"
  } else {
    $report += "$envRel : not found"
  }
}

# ── 5. Claude Code transcripts for this project ──────────────────────────────
$claudeProjects = "$env:USERPROFILE\.claude\projects"
if (Test-Path $claudeProjects) {
  Get-ChildItem $claudeProjects -Directory | Where-Object { $_.Name -like "*yovlisshemdzle*" } | ForEach-Object {
    robocopy $_.FullName (Join-Path $out ("claude-transcripts\" + $_.Name)) /E /R:2 /W:2 /NFL /NDL /NJH | Out-Null
    $report += "transcripts $($_.Name): copied"
  }
} else {
  $report += "no ~\.claude\projects on this machine"
}

# ── Zip it all ───────────────────────────────────────────────────────────────
$zip = Join-Path ([Environment]::GetFolderPath("Desktop")) "ava-recovery.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path "$out\*" -DestinationPath $zip
$zipMB = [Math]::Round((Get-Item $zip).Length / 1MB, 1)

Write-Host ""
Write-Host "==== SUMMARY ====" -ForegroundColor Green
$report | ForEach-Object { Write-Host "  $_" }
Write-Host ""
Write-Host "DONE: $zip ($zipMB MB)" -ForegroundColor Green
Write-Host "Copy ava-recovery.zip to the new PC (USB / OneDrive) and tell Claude where it is." -ForegroundColor Yellow
