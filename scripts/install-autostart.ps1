# Run from an Administrator PowerShell.
# Builds the server, installs pm2 + pm2-windows-startup, configures auto-launch.
$ErrorActionPreference = "Stop"

Push-Location $PSScriptRoot\..

npm install
npm -w server run build
npm -w web run build

npm install -g pm2 pm2-windows-startup

pm2 start ecosystem.config.cjs
pm2 save
pm2-startup install

Write-Host "Ava is configured to start on boot. Visit http://localhost:8787/_status"
Pop-Location
