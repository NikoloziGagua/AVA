param(
  [int]$Port = 9222,
  [Parameter(Mandatory = $true)]
  [string]$ProfileDir,
  [string]$ExecutablePath = "",
  [switch]$RestartIfInvisible,
  [switch]$StartIfMissing
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "start-on-input-desktop.ps1")

# All browser-window checks deliberately enumerate WinSta0\Default, not the
# caller's desktop. Codex and processes launched by Codex can run on an isolated
# CodexSandboxDesktop-* where a window is technically visible but the owner
# cannot see it.
if (-not ("AvaBrowserWindow" -as [type])) {
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class AvaBrowserWindow {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    public sealed class FocusResult {
        public bool Ok;
        public bool Visible;
        public bool OnScreen;
        public bool Foreground;
        public long Handle;
        public string Title = "";
        public string Desktop = "";
        public string Error = "";
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr OpenDesktop(
        string desktop,
        uint flags,
        bool inherit,
        uint desiredAccess
    );

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool CloseDesktop(IntPtr desktop);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetThreadDesktop(IntPtr desktop);

    [DllImport("user32.dll")]
    private static extern IntPtr GetThreadDesktop(uint threadId);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetUserObjectInformation(
        IntPtr handle,
        int index,
        StringBuilder info,
        int length,
        out int needed
    );

    [DllImport("user32.dll")]
    private static extern bool EnumDesktopWindows(
        IntPtr desktop,
        EnumWindowsProc callback,
        IntPtr lParam
    );

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindowAsync(IntPtr hWnd, int command);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int command);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint attach, uint attachTo, bool value);

    [DllImport("user32.dll")]
    private static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder className, int maxCount);

    [DllImport("user32.dll")]
    private static extern bool SetWindowPos(
        IntPtr hWnd,
        IntPtr insertAfter,
        int x,
        int y,
        int width,
        int height,
        uint flags
    );

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out Rect rect);

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int index);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(
        IntPtr hWnd,
        int attribute,
        out int value,
        int size
    );

    private const uint DESKTOP_ACCESS = 0x01C1;

    private static IntPtr OpenDefaultDesktop() {
        return OpenDesktop("Default", 0, false, DESKTOP_ACCESS);
    }

    private static string ObjectName(IntPtr handle) {
        if (handle == IntPtr.Zero) return "";
        int needed;
        GetUserObjectInformation(handle, 2, null, 0, out needed);
        if (needed <= 0) return "";
        StringBuilder value = new StringBuilder(needed / 2 + 1);
        return GetUserObjectInformation(handle, 2, value, needed, out needed)
            ? value.ToString()
            : "";
    }

    private static string WindowClass(IntPtr hWnd) {
        StringBuilder value = new StringBuilder(256);
        GetClassName(hWnd, value, value.Capacity);
        return value.ToString();
    }

    public static string WindowTitle(IntPtr hWnd) {
        int length = GetWindowTextLength(hWnd);
        StringBuilder text = new StringBuilder(Math.Max(length + 1, 2));
        GetWindowText(hWnd, text, text.Capacity);
        return text.ToString();
    }

    public static string WindowDesktop(IntPtr hWnd) {
        uint processId;
        uint threadId = GetWindowThreadProcessId(hWnd, out processId);
        return ObjectName(GetThreadDesktop(threadId));
    }

    private static bool IsCloaked(IntPtr hWnd) {
        int cloaked = 0;
        int result = DwmGetWindowAttribute(hWnd, 14, out cloaked, sizeof(int));
        return result == 0 && cloaked != 0;
    }

    private static IntPtr FindMainWindow(IntPtr desktop, int processId) {
        IntPtr best = IntPtr.Zero;
        long bestArea = 0;
        EnumDesktopWindows(desktop, delegate(IntPtr hWnd, IntPtr lParam) {
            uint owner;
            GetWindowThreadProcessId(hWnd, out owner);
            if (owner != (uint)processId ||
                !IsWindowVisible(hWnd) ||
                IsCloaked(hWnd) ||
                WindowClass(hWnd) != "Chrome_WidgetWin_1") {
                return true;
            }

            Rect rect;
            if (!GetWindowRect(hWnd, out rect)) return true;
            int width = Math.Max(0, rect.Right - rect.Left);
            int height = Math.Max(0, rect.Bottom - rect.Top);
            bool iconic = IsIconic(hWnd);
            if (!iconic && (width < 400 || height < 300)) return true;
            // A minimized Chrome main window reports the Windows sentinel
            // rectangle around -32000 with only icon-sized dimensions. Prefer
            // it so FocusOnDefault can restore it before testing its bounds.
            long area = iconic ? long.MaxValue : (long)width * height;
            if (area > bestArea) {
                best = hWnd;
                bestArea = area;
            }
            return true;
        }, IntPtr.Zero);
        return best;
    }

    public static IntPtr FindMainWindowOnDefault(int processId) {
        IntPtr desktop = OpenDefaultDesktop();
        if (desktop == IntPtr.Zero) return IntPtr.Zero;
        try { return FindMainWindow(desktop, processId); }
        finally { CloseDesktop(desktop); }
    }

    public static bool IsOnVirtualScreen(IntPtr hWnd) {
        Rect rect;
        if (!GetWindowRect(hWnd, out rect)) return false;
        int left = GetSystemMetrics(76);
        int top = GetSystemMetrics(77);
        int right = left + GetSystemMetrics(78);
        int bottom = top + GetSystemMetrics(79);
        return rect.Right > left && rect.Left < right &&
               rect.Bottom > top && rect.Top < bottom;
    }

    private static void MoveOntoVirtualScreen(IntPtr hWnd) {
        int left = GetSystemMetrics(76);
        int top = GetSystemMetrics(77);
        int virtualWidth = Math.Max(GetSystemMetrics(78), 640);
        int virtualHeight = Math.Max(GetSystemMetrics(79), 480);
        int width = Math.Min(1200, Math.Max(640, virtualWidth - 80));
        int height = Math.Min(800, Math.Max(480, virtualHeight - 80));
        SetWindowPos(hWnd, IntPtr.Zero, left + 40, top + 40, width, height, 0x0040);
    }

    public static FocusResult FocusOnDefault(int processId) {
        FocusResult result = new FocusResult();
        Thread worker = new Thread(delegate() {
            IntPtr desktop = OpenDefaultDesktop();
            if (desktop == IntPtr.Zero) {
                result.Error = "Windows could not open WinSta0\\Default.";
                return;
            }
            // Do not close this handle while the worker is assigned to it. The
            // short-lived PowerShell process releases it when it exits.
            if (!SetThreadDesktop(desktop)) {
                result.Error = "Windows would not move the focus worker to WinSta0\\Default.";
                return;
            }

            IntPtr window = FindMainWindow(desktop, processId);
            if (window == IntPtr.Zero) {
                result.Error = "No main AVA Chrome window exists on WinSta0\\Default.";
                return;
            }

            ShowWindowAsync(window, 9);
            ShowWindow(window, 9);
            Thread.Sleep(150);
            if (!IsOnVirtualScreen(window)) MoveOntoVirtualScreen(window);

            IntPtr foregroundBefore = GetForegroundWindow();
            uint ignored;
            uint foregroundThread = foregroundBefore == IntPtr.Zero
                ? 0
                : GetWindowThreadProcessId(foregroundBefore, out ignored);
            uint currentThread = GetCurrentThreadId();
            bool attached = foregroundThread != 0 &&
                            foregroundThread != currentThread &&
                            AttachThreadInput(currentThread, foregroundThread, true);
            try {
                SetWindowPos(window, new IntPtr(-1), 0, 0, 0, 0, 0x0053);
                SetWindowPos(window, new IntPtr(-2), 0, 0, 0, 0, 0x0053);
                BringWindowToTop(window);
                SetForegroundWindow(window);
            } finally {
                if (attached) AttachThreadInput(currentThread, foregroundThread, false);
            }
            Thread.Sleep(200);

            IntPtr foreground = GetForegroundWindow();
            uint foregroundPid = 0;
            if (foreground != IntPtr.Zero) {
                GetWindowThreadProcessId(foreground, out foregroundPid);
            }

            result.Handle = window.ToInt64();
            result.Visible = IsWindowVisible(window) && !IsCloaked(window);
            result.OnScreen = IsOnVirtualScreen(window);
            result.Foreground = foregroundPid == (uint)processId;
            result.Title = WindowTitle(window);
            // This HWND was enumerated from an explicit handle to the Default
            // desktop by a worker thread assigned to that same desktop.
            // GetThreadDesktop(targetThread) can return an empty name across
            // Codex's desktop boundary even though the enumeration is valid.
            result.Desktop = "Default";
            result.Ok = result.Visible &&
                        result.OnScreen &&
                        result.Desktop.Equals("Default", StringComparison.OrdinalIgnoreCase);
        });
        worker.SetApartmentState(ApartmentState.STA);
        worker.Start();
        worker.Join();
        return result;
    }
}
"@
}

function Get-AvaBrowserPid {
  $pattern = "127\.0\.0\.1:$Port\s+.*LISTENING\s+(\d+)\s*$"
  foreach ($line in (netstat -ano -p tcp)) {
    if ($line -match $pattern) {
      return [int]$Matches[1]
    }
  }
  return 0
}

function Test-AvaChromeEndpoint {
  try {
    $version = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 2
    return [bool]$version.webSocketDebuggerUrl
  } catch {
    return $false
  }
}

function Find-BrowserExecutable([int]$BrowserPid) {
  if ($ExecutablePath -and (Test-Path -LiteralPath $ExecutablePath)) {
    return (Resolve-Path -LiteralPath $ExecutablePath).Path
  }

  if ($BrowserPid -gt 0) {
    try {
      $processPath = (Get-Process -Id $BrowserPid -ErrorAction Stop).Path
      if ($processPath -and (Test-Path -LiteralPath $processPath)) {
        return $processPath
      }
    } catch {
      # Fall through to installed-browser discovery.
    }
  }

  $candidates = @(
    $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe" }),
    $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe" }),
    $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe" }),
    $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe" }),
    $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe" })
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

  return $candidates | Select-Object -First 1
}

function Start-AvaBrowserWindow([string]$Browser, [string]$ResolvedProfile) {
  $arguments = @(
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=$Port",
    "--user-data-dir=$ResolvedProfile",
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-crash-restore-bubble",
    "--start-maximized",
    "--new-window",
    "about:blank"
  )
  return Start-OnInputDesktop `
    -FilePath $Browser `
    -ArgumentList $arguments `
    -WorkingDirectory (Split-Path -Parent $Browser)
}

function Wait-ForAvaWindow([int]$Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  $foundPid = 0
  $foundWindow = [IntPtr]::Zero
  do {
    Start-Sleep -Milliseconds 150
    $foundPid = Get-AvaBrowserPid
    if ($foundPid -gt 0 -and (Test-AvaChromeEndpoint)) {
      $foundWindow = [AvaBrowserWindow]::FindMainWindowOnDefault($foundPid)
    }
  } while ($foundWindow -eq [IntPtr]::Zero -and (Get-Date) -lt $deadline)
  return @{
    Pid = $foundPid
    Window = $foundWindow
  }
}

try {
  $resolvedProfile = [System.IO.Path]::GetFullPath($ProfileDir)
  New-Item -ItemType Directory -Path $resolvedProfile -Force | Out-Null

  $browserPid = Get-AvaBrowserPid
  if ($browserPid -gt 0 -and -not (Test-AvaChromeEndpoint)) {
    throw "Port $Port is occupied, but it is not AVA Chrome."
  }

  $browser = Find-BrowserExecutable $browserPid
  if (-not $browser) {
    throw "Could not locate Google Chrome or Microsoft Edge."
  }

  $createdWindow = $false
  $restarted = $false
  if ($browserPid -le 0) {
    if (-not $StartIfMissing) {
      throw "Nothing is listening on AVA's Chrome port $Port."
    }
    $startedPid = Start-AvaBrowserWindow $browser $resolvedProfile
    $createdWindow = $true
    $found = Wait-ForAvaWindow 20
    $browserPid = $found.Pid
    $window = $found.Window
  } else {
    $window = [AvaBrowserWindow]::FindMainWindowOnDefault($browserPid)
  }

  if ($window -eq [IntPtr]::Zero -and $RestartIfInvisible) {
    # The listener exists but its UI is on CodexSandboxDesktop-* (or it has no
    # usable main window). Chrome cannot move an existing native window between
    # desktops, so replace only AVA's private-port process tree.
    if ($browserPid -gt 0) {
      & taskkill.exe /PID $browserPid /T /F 2>$null | Out-Null
      $portDeadline = (Get-Date).AddSeconds(8)
      do {
        Start-Sleep -Milliseconds 150
      } while ((Get-AvaBrowserPid) -gt 0 -and (Get-Date) -lt $portDeadline)
    }

    $startedPid = Start-AvaBrowserWindow $browser $resolvedProfile
    $restarted = $true
    $found = Wait-ForAvaWindow 20
    $browserPid = $found.Pid
    $window = $found.Window
  }

  if ($window -eq [IntPtr]::Zero) {
    throw "AVA Chrome is not on your visible WinSta0\Default desktop."
  }

  $focused = [AvaBrowserWindow]::FocusOnDefault($browserPid)
  if (-not $focused.Ok) {
    throw $(
      if ($focused.Error) {
        $focused.Error
      } else {
        "Default-desktop verification failed " +
        "(visible=$($focused.Visible), onScreen=$($focused.OnScreen), " +
        "foreground=$($focused.Foreground), desktop='$($focused.Desktop)', " +
        "title='$($focused.Title)', handle=$($focused.Handle))."
      }
    )
  }

  [ordered]@{
    ok = $true
    visible = $focused.Visible
    onScreen = $focused.OnScreen
    foreground = $focused.Foreground
    desktop = $focused.Desktop
    pid = $browserPid
    handle = $focused.Handle
    title = $focused.Title
    createdWindow = $createdWindow
    restarted = $restarted
    profile = $resolvedProfile
  } | ConvertTo-Json -Compress
} catch {
  [ordered]@{
    ok = $false
    visible = $false
    onScreen = $false
    foreground = $false
    desktop = ""
    reason = $_.Exception.Message
  } | ConvertTo-Json -Compress
}
