param(
  [string]$FilePath = "",
  [string]$Arguments = "",
  [string]$WorkingDirectory = "",
  [int]$WindowStyle = 1
)

$ErrorActionPreference = "Stop"

function Get-AvaExplorerBroker {
  $shell = New-Object -ComObject Shell.Application
  $window = @($shell.Windows()) |
    Where-Object { $_.FullName -like "*\explorer.exe" } |
    Select-Object -First 1

  if (-not $window) {
    # Shell.Application.Open is handled by the real Explorer shell. Keep one
    # folder window available as the launch broker if the owner closed every
    # File Explorer window.
    $shell.Open([Environment]::GetFolderPath("MyDocuments"))
    $deadline = (Get-Date).AddSeconds(5)
    do {
      Start-Sleep -Milliseconds 100
      $window = @($shell.Windows()) |
        Where-Object { $_.FullName -like "*\explorer.exe" } |
        Select-Object -First 1
    } while (-not $window -and (Get-Date) -lt $deadline)
  }

  if (-not $window) {
    throw "No interactive Explorer window is available as the Default-desktop broker."
  }
  return $window.Document.Application
}

function Get-AvaCurrentDesktop {
  # diagnose-ava-desktop.ps1 exposes this through Win32. Keep this lightweight
  # helper local so callers do not need to parse diagnostics.
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class AvaCurrentDesktopName {
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] private static extern IntPtr GetThreadDesktop(uint id);
    [DllImport("user32.dll", SetLastError=true)]
    private static extern bool GetUserObjectInformation(
        IntPtr handle, int index, StringBuilder value, int length, out int needed);
    public static string Read() {
        IntPtr desktop = GetThreadDesktop(GetCurrentThreadId());
        int needed;
        GetUserObjectInformation(desktop, 2, null, 0, out needed);
        StringBuilder value = new StringBuilder(needed / 2 + 1);
        return GetUserObjectInformation(desktop, 2, value, needed, out needed)
            ? value.ToString() : "";
    }
}
"@ -ErrorAction SilentlyContinue
  [AvaCurrentDesktopName]::Read()
}

function Invoke-OnDefaultDesktop {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [string]$Arguments = "",
    [string]$WorkingDirectory = "",
    [int]$WindowStyle = 1
  )

  $broker = Get-AvaExplorerBroker
  $broker.ShellExecute(
    $FilePath,
    $Arguments,
    $WorkingDirectory,
    "open",
    $WindowStyle
  )
}

if ($FilePath) {
  Invoke-OnDefaultDesktop `
    -FilePath $FilePath `
    -Arguments $Arguments `
    -WorkingDirectory $WorkingDirectory `
    -WindowStyle $WindowStyle
}
