$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$modulePath = Join-Path $PSScriptRoot "activepieces-runtime-policy.psm1"
Import-Module $modulePath -Force

function Assert-Equal {
  param(
    [Parameter(Mandatory)]
    $Actual,

    [Parameter(Mandatory)]
    $Expected,

    [Parameter(Mandatory)]
    [string]$Message
  )

  if ($Actual -ne $Expected) {
    throw "$Message (expected '$Expected', got '$Actual')"
  }
}

$transientCases = @(
  'bun: unknown error:',
  'Error: spawn EPERM',
  'Error: spawn EACCES',
  'Access is denied while starting turbo',
  'Executable blocked by Windows Device Guard',
  'This app has been blocked by your system administrator'
)

foreach ($case in $transientCases) {
  Assert-Equal `
    -Actual (Test-ActivepiecesTransientLaunchFailure -Output $case) `
    -Expected $true `
    -Message "Known transient launch failure was not classified for retry: $case"
}

$terminalCases = @(
  'Activepieces source identity mismatch.',
  'EADDRINUSE: address already in use',
  'Invalid AP_DB_TYPE value',
  'TypeScript error TS2322: Type string is not assignable to number'
)

foreach ($case in $terminalCases) {
  Assert-Equal `
    -Actual (Test-ActivepiecesTransientLaunchFailure -Output $case) `
    -Expected $false `
    -Message "Non-transient launch failure was incorrectly classified for retry: $case"
}

$fixtureDir = Join-Path ([System.IO.Path]::GetTempPath()) ("ava-activepieces-policy-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $fixtureDir | Out-Null
try {
  $stdoutPath = Join-Path $fixtureDir "stdout.log"
  $stderrPath = Join-Path $fixtureDir "stderr.log"
  [System.IO.File]::WriteAllLines($stdoutPath, @("first", "second", "bun: unknown error:"))
  [System.IO.File]::WriteAllLines($stderrPath, @("turbo failed", "spawn EPERM"))

  $evidence = Get-ActivepiecesLaunchEvidence -StdoutPath $stdoutPath -StderrPath $stderrPath -TailLines 2
  Assert-Equal -Actual ($evidence -match '\[stdout\]') -Expected $true -Message "stdout heading missing"
  Assert-Equal -Actual ($evidence -match 'bun: unknown error') -Expected $true -Message "stdout failure missing"
  Assert-Equal -Actual ($evidence -match '\[stderr\]') -Expected $true -Message "stderr heading missing"
  Assert-Equal -Actual ($evidence -match 'spawn EPERM') -Expected $true -Message "stderr failure missing"
  Assert-Equal -Actual ($evidence -match '(?m)^first$') -Expected $false -Message "tail bound was not enforced"

  Remove-Item -LiteralPath $stdoutPath, $stderrPath
  $emptyEvidence = Get-ActivepiecesLaunchEvidence -StdoutPath $stdoutPath -StderrPath $stderrPath
  Assert-Equal -Actual $emptyEvidence -Expected "No runtime output was produced." -Message "missing-log evidence was not honest"
} finally {
  Remove-Item -LiteralPath $fixtureDir -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Output "Activepieces runtime policy tests passed."
