Set-StrictMode -Version Latest

function Test-ActivepiecesTransientLaunchFailure {
  [CmdletBinding()]
  param(
    [AllowEmptyString()]
    [string]$Output = ""
  )

  $transientPatterns = @(
    '(?im)\bbun:\s*unknown error\b',
    '(?im)\bspawn\s+EPERM\b',
    '(?im)\bspawn\s+EACCES\b',
    '(?im)\baccess is denied\b',
    '(?im)\bblocked by (?:windows )?(?:device guard|application control|group policy)\b',
    '(?im)\bthis app has been blocked by your system administrator\b'
  )

  foreach ($pattern in $transientPatterns) {
    if ($Output -match $pattern) {
      return $true
    }
  }

  return $false
}

function Get-ActivepiecesLaunchEvidence {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)]
    [string]$StdoutPath,

    [Parameter(Mandatory)]
    [string]$StderrPath,

    [ValidateRange(1, 200)]
    [int]$TailLines = 40
  )

  $sections = @()
  foreach ($item in @(
    @{ Label = "stdout"; Path = $StdoutPath },
    @{ Label = "stderr"; Path = $StderrPath }
  )) {
    $body = if (Test-Path -LiteralPath $item.Path) {
      ((Get-Content -LiteralPath $item.Path -Tail $TailLines -ErrorAction SilentlyContinue) -join [Environment]::NewLine).Trim()
    } else {
      ""
    }

    if ($body) {
      $sections += "[$($item.Label)]$([Environment]::NewLine)$body"
    }
  }

  if ($sections.Count -eq 0) {
    return "No runtime output was produced."
  }

  return $sections -join ([Environment]::NewLine + [Environment]::NewLine)
}

Export-ModuleMember -Function Test-ActivepiecesTransientLaunchFailure, Get-ActivepiecesLaunchEvidence
