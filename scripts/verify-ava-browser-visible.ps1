$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$profileDir = Join-Path $repoRoot "server\data\chrome-profile"
$proofPath = Join-Path $repoRoot "server\data\ava-browser-visible-proof.png"

$focus = & (Join-Path $PSScriptRoot "focus-ava-browser.ps1") `
  -Port 9222 `
  -ProfileDir $profileDir |
  ConvertFrom-Json
if (-not $focus.ok) {
  throw "AVA Chrome focus failed: $($focus.reason)"
}

Start-Sleep -Milliseconds 250
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$screen = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bitmap = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.CopyFromScreen($screen.X, $screen.Y, 0, 0, $bitmap.Size)
  $bitmap.Save($proofPath, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $graphics.Dispose()
  $bitmap.Dispose()
}

[ordered]@{
  ok = $true
  proof = $proofPath
  browser = $focus
} | ConvertTo-Json -Depth 4 -Compress
