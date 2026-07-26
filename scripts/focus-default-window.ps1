<#
.SYNOPSIS
Finds and optionally focuses a native window on WinSta0\Default.

.DESCRIPTION
Codex can run on a CodexSandboxDesktop-* desktop. Get-Process.MainWindowHandle
and EnumWindows from that caller desktop can therefore miss the window the
owner can actually see. This helper opens WinSta0\Default explicitly and uses
EnumDesktopWindows against that desktop handle.

The script is read-only unless -Focus is supplied. It never launches a process,
types text, sends keys, or clicks. With -Focus it may restore the matched window,
move an entirely off-screen window onto the virtual screen, and request focus.

-TitlePattern is a case-insensitive .NET regular expression. When both
-ProcessId and -TitlePattern are supplied, a window must match both.
#>

[CmdletBinding()]
param(
  [Alias("Pid")]
  [int]$ProcessId = 0,
  [string]$TitlePattern = "",
  [switch]$Focus,
  [ValidateRange(1, 50)]
  [int]$MaxCandidates = 20
)

$ErrorActionPreference = "Stop"

if (-not ("AvaDefaultDesktopWindow" -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class AvaDefaultDesktopWindow {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    public sealed class WindowInfo {
        public long Handle;
        public int ProcessId;
        public string Title = "";
        public string ClassName = "";
        public string Desktop = "WinSta0\\Default";
        public bool Visible;
        public bool OnScreen;
        public bool Foreground;
        public bool Minimized;
        public long Area;
    }

    public sealed class EnumerationResult {
        public bool Ok;
        public string Error = "";
        public WindowInfo[] Windows = new WindowInfo[0];
    }

    public sealed class FocusResult {
        public bool Ok;
        public string Error = "";
        public WindowInfo Window;
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

    // READOBJECTS | ENUMERATE | WRITEOBJECTS | SWITCHDESKTOP. WRITEOBJECTS is
    // needed only by the explicitly requested restore/move/focus path.
    private const uint DESKTOP_ACCESS = 0x01C1;
    private const int SW_RESTORE = 9;
    private const uint SWP_NOSIZE = 0x0001;
    private const uint SWP_NOMOVE = 0x0002;
    private const uint SWP_NOACTIVATE = 0x0010;
    private const uint SWP_SHOWWINDOW = 0x0040;
    private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
    private static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);

    private static IntPtr OpenDefaultDesktop() {
        return OpenDesktop("Default", 0, false, DESKTOP_ACCESS);
    }

    private static string WindowTitle(IntPtr hWnd) {
        int length = GetWindowTextLength(hWnd);
        StringBuilder value = new StringBuilder(Math.Max(length + 1, 2));
        GetWindowText(hWnd, value, value.Capacity);
        return value.ToString();
    }

    private static string WindowClass(IntPtr hWnd) {
        StringBuilder value = new StringBuilder(256);
        GetClassName(hWnd, value, value.Capacity);
        return value.ToString();
    }

    private static bool IsCloaked(IntPtr hWnd) {
        int cloaked = 0;
        int result = DwmGetWindowAttribute(hWnd, 14, out cloaked, sizeof(int));
        return result == 0 && cloaked != 0;
    }

    private static bool IsOnVirtualScreen(IntPtr hWnd) {
        Rect rect;
        if (!GetWindowRect(hWnd, out rect)) return false;
        int left = GetSystemMetrics(76);
        int top = GetSystemMetrics(77);
        int width = GetSystemMetrics(78);
        int height = GetSystemMetrics(79);
        if (width <= 0 || height <= 0) return false;
        int right = left + width;
        int bottom = top + height;
        return rect.Right > left && rect.Left < right &&
               rect.Bottom > top && rect.Top < bottom;
    }

    private static WindowInfo ReadWindow(IntPtr hWnd, IntPtr foreground) {
        uint owner;
        GetWindowThreadProcessId(hWnd, out owner);

        Rect rect;
        long area = 0;
        if (GetWindowRect(hWnd, out rect)) {
            long width = Math.Max(0L, (long)rect.Right - rect.Left);
            long height = Math.Max(0L, (long)rect.Bottom - rect.Top);
            area = width * height;
        }

        WindowInfo info = new WindowInfo();
        info.Handle = hWnd.ToInt64();
        info.ProcessId = unchecked((int)owner);
        info.Title = WindowTitle(hWnd);
        info.ClassName = WindowClass(hWnd);
        info.Visible = IsWindowVisible(hWnd) && !IsCloaked(hWnd);
        info.OnScreen = IsOnVirtualScreen(hWnd);
        info.Foreground = hWnd == foreground;
        info.Minimized = IsIconic(hWnd);
        info.Area = area;
        return info;
    }

    private static List<WindowInfo> EnumerateDesktop(IntPtr desktop) {
        List<WindowInfo> windows = new List<WindowInfo>();
        IntPtr foreground = GetForegroundWindow();
        bool enumerated = EnumDesktopWindows(
            desktop,
            delegate(IntPtr hWnd, IntPtr lParam) {
                windows.Add(ReadWindow(hWnd, foreground));
                return true;
            },
            IntPtr.Zero
        );
        if (!enumerated) {
            throw new InvalidOperationException(
                "EnumDesktopWindows failed (Win32 " +
                Marshal.GetLastWin32Error().ToString() + ")."
            );
        }
        return windows;
    }

    private static bool RunOnDefaultDesktop(Action<IntPtr> action, out string error) {
        bool ok = false;
        string workerError = "";
        Thread worker = new Thread(
            delegate() {
                IntPtr desktop = OpenDefaultDesktop();
                if (desktop == IntPtr.Zero) {
                    workerError = "Windows could not open WinSta0\\Default (Win32 " +
                                  Marshal.GetLastWin32Error().ToString() + ").";
                    return;
                }

                IntPtr original = GetThreadDesktop(GetCurrentThreadId());
                bool moved = false;
                try {
                    moved = SetThreadDesktop(desktop);
                    if (!moved) {
                        workerError = "Windows would not move the worker to WinSta0\\Default (Win32 " +
                                      Marshal.GetLastWin32Error().ToString() + ").";
                        return;
                    }
                    action(desktop);
                    ok = true;
                } catch (Exception ex) {
                    workerError = ex.Message;
                } finally {
                    // Never close a desktop while the thread is assigned to it.
                    // This worker owns no windows/hooks, so restore first, then
                    // close the explicit Default handle.
                    bool safeToClose = !moved;
                    if (moved && original != IntPtr.Zero) {
                        safeToClose = SetThreadDesktop(original);
                    }
                    if (safeToClose) {
                        CloseDesktop(desktop);
                    }
                }
            }
        );
        worker.IsBackground = true;
        worker.SetApartmentState(ApartmentState.STA);
        worker.Start();
        if (!worker.Join(5000)) {
            error = "Timed out while inspecting WinSta0\\Default.";
            return false;
        }
        error = workerError;
        return ok;
    }

    public static EnumerationResult EnumerateDefault() {
        EnumerationResult result = new EnumerationResult();
        List<WindowInfo> windows = new List<WindowInfo>();
        string error;
        result.Ok = RunOnDefaultDesktop(
            delegate(IntPtr desktop) { windows = EnumerateDesktop(desktop); },
            out error
        );
        result.Error = error;
        result.Windows = windows.ToArray();
        return result;
    }

    private static bool ContainsHandle(IntPtr desktop, IntPtr target) {
        bool found = false;
        bool enumerated = EnumDesktopWindows(
            desktop,
            delegate(IntPtr hWnd, IntPtr lParam) {
                if (hWnd == target) {
                    found = true;
                    return false;
                }
                return true;
            },
            IntPtr.Zero
        );
        // EnumDesktopWindows returns false when our callback intentionally stops.
        return found || enumerated && found;
    }

    private static void MoveOntoVirtualScreen(IntPtr hWnd) {
        int left = GetSystemMetrics(76);
        int top = GetSystemMetrics(77);
        int virtualWidth = GetSystemMetrics(78);
        int virtualHeight = GetSystemMetrics(79);
        if (virtualWidth <= 0 || virtualHeight <= 0) return;

        int margin = Math.Min(40, Math.Max(0, Math.Min(virtualWidth, virtualHeight) / 20));
        int width = Math.Min(1200, Math.Max(320, virtualWidth - (margin * 2)));
        int height = Math.Min(800, Math.Max(240, virtualHeight - (margin * 2)));
        SetWindowPos(
            hWnd,
            IntPtr.Zero,
            left + margin,
            top + margin,
            width,
            height,
            SWP_SHOWWINDOW
        );
    }

    public static FocusResult FocusOnDefault(long handle) {
        FocusResult result = new FocusResult();
        string error;
        result.Ok = RunOnDefaultDesktop(
            delegate(IntPtr desktop) {
                IntPtr target = new IntPtr(handle);
                if (!ContainsHandle(desktop, target)) {
                    throw new InvalidOperationException(
                        "The selected HWND is no longer on WinSta0\\Default."
                    );
                }

                ShowWindowAsync(target, SW_RESTORE);
                ShowWindow(target, SW_RESTORE);
                Thread.Sleep(150);
                if (!IsOnVirtualScreen(target)) {
                    MoveOntoVirtualScreen(target);
                    Thread.Sleep(100);
                }

                IntPtr foregroundBefore = GetForegroundWindow();
                uint ignored;
                uint foregroundThread = foregroundBefore == IntPtr.Zero
                    ? 0
                    : GetWindowThreadProcessId(foregroundBefore, out ignored);
                uint targetPid;
                uint targetThread = GetWindowThreadProcessId(target, out targetPid);
                uint currentThread = GetCurrentThreadId();

                bool attachedForeground = foregroundThread != 0 &&
                                          foregroundThread != currentThread &&
                                          AttachThreadInput(currentThread, foregroundThread, true);
                bool attachedTarget = targetThread != 0 &&
                                      targetThread != currentThread &&
                                      targetThread != foregroundThread &&
                                      AttachThreadInput(currentThread, targetThread, true);
                try {
                    uint noMoveResizeActivate =
                        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW;
                    SetWindowPos(target, HWND_TOPMOST, 0, 0, 0, 0, noMoveResizeActivate);
                    SetWindowPos(target, HWND_NOTOPMOST, 0, 0, 0, 0, noMoveResizeActivate);
                    BringWindowToTop(target);
                    SetForegroundWindow(target);
                } finally {
                    if (attachedTarget) {
                        AttachThreadInput(currentThread, targetThread, false);
                    }
                    if (attachedForeground) {
                        AttachThreadInput(currentThread, foregroundThread, false);
                    }
                }
                Thread.Sleep(200);

                result.Window = ReadWindow(target, GetForegroundWindow());
                if (!result.Window.Visible) {
                    throw new InvalidOperationException("The matched window is still not visible.");
                }
                if (!result.Window.OnScreen) {
                    throw new InvalidOperationException("The matched window is still off-screen.");
                }
                if (!result.Window.Foreground) {
                    throw new InvalidOperationException(
                        "Windows restored the matched window but denied foreground focus."
                    );
                }
            },
            out error
        );
        result.Error = error;
        return result;
    }
}
"@
}

function ConvertTo-WindowRecord {
  param([Parameter(Mandatory = $true)]$Window)

  [ordered]@{
    hwnd = [long]$Window.Handle
    pid = [int]$Window.ProcessId
    title = [string]$Window.Title
    class = [string]$Window.ClassName
    desktop = [string]$Window.Desktop
    visible = [bool]$Window.Visible
    onScreen = [bool]$Window.OnScreen
    foreground = [bool]$Window.Foreground
  }
}

function Sort-DefaultWindows {
  param([object[]]$Windows)

  @(
    $Windows | Sort-Object -Property @(
      @{ Expression = { if ($_.Foreground) { 0 } else { 1 } } },
      @{ Expression = { if ($_.Visible -and $_.OnScreen) { 0 } elseif ($_.Visible) { 1 } else { 2 } } },
      @{ Expression = { if ([string]::IsNullOrWhiteSpace($_.Title)) { 1 } else { 0 } } },
      @{ Expression = { -[long]$_.Area } },
      @{ Expression = { [int]$_.ProcessId } },
      @{ Expression = { [long]$_.Handle } }
    )
  )
}

try {
  if ($ProcessId -lt 0) {
    throw "-ProcessId must be a positive process id."
  }

  $titleRegex = $null
  if (-not [string]::IsNullOrWhiteSpace($TitlePattern)) {
    try {
      $titleRegex = [regex]::new(
        $TitlePattern,
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase,
        [TimeSpan]::FromMilliseconds(250)
      )
    } catch {
      throw "Invalid -TitlePattern regular expression: $($_.Exception.Message)"
    }
  }

  if ($Focus -and $ProcessId -le 0 -and $null -eq $titleRegex) {
    throw "-Focus requires -ProcessId and/or -TitlePattern; refusing to focus an arbitrary window."
  }

  $snapshot = [AvaDefaultDesktopWindow]::EnumerateDefault()
  if (-not $snapshot.Ok) {
    throw $(if ($snapshot.Error) { $snapshot.Error } else { "Could not enumerate WinSta0\Default." })
  }

  $ranked = @(Sort-DefaultWindows @($snapshot.Windows))
  $matches = @(
    $ranked | Where-Object {
      $pidMatches = $ProcessId -le 0 -or $_.ProcessId -eq $ProcessId
      $titleMatches = $null -eq $titleRegex -or $titleRegex.IsMatch([string]$_.Title)
      $pidMatches -and $titleMatches
    }
  )

  $matchedWindow = if ($ProcessId -gt 0 -or $null -ne $titleRegex) {
    $matches | Select-Object -First 1
  } else {
    $null
  }

  $focusError = ""
  if ($Focus -and $null -ne $matchedWindow) {
    $focusResult = [AvaDefaultDesktopWindow]::FocusOnDefault([long]$matchedWindow.Handle)
    if ($null -ne $focusResult.Window) {
      $matchedWindow = $focusResult.Window
    }
    if (-not $focusResult.Ok) {
      $focusError = if ($focusResult.Error) {
        $focusResult.Error
      } else {
        "Windows could not focus the matched window."
      }
    }
  }

  # Put exact matches first, then PID/title near-misses, then the best visible
  # Default-desktop windows. De-duplicate and cap the diagnostic payload.
  $candidateSource = @()
  if ($null -ne $matchedWindow) {
    $candidateSource += @($matchedWindow)
  }
  $candidateSource += @($matches)
  if ($ProcessId -gt 0) {
    $candidateSource += @($ranked | Where-Object { $_.ProcessId -eq $ProcessId })
  }
  if ($null -ne $titleRegex) {
    $candidateSource += @($ranked | Where-Object { $titleRegex.IsMatch([string]$_.Title) })
  }
  $candidateSource += $ranked

  $seen = @{}
  $candidateRecords = @()
  foreach ($window in $candidateSource) {
    $key = [string][long]$window.Handle
    if ($seen.ContainsKey($key)) {
      continue
    }
    $seen[$key] = $true
    $candidateRecords += ConvertTo-WindowRecord $window
    if ($candidateRecords.Count -ge $MaxCandidates) {
      break
    }
  }

  $selectorSupplied = $ProcessId -gt 0 -or $null -ne $titleRegex
  $ok = if (-not $selectorSupplied) {
    $true
  } elseif ($null -eq $matchedWindow) {
    $false
  } elseif ($Focus) {
    [string]::IsNullOrEmpty($focusError)
  } else {
    $true
  }

  $reason = if ($focusError) {
    $focusError
  } elseif ($selectorSupplied -and $null -eq $matchedWindow) {
    "No window on WinSta0\Default matched the requested selector."
  } elseif (-not $selectorSupplied) {
    "Inventory only; provide -ProcessId and/or -TitlePattern to select a window."
  } else {
    ""
  }

  [ordered]@{
    ok = $ok
    matched = if ($null -ne $matchedWindow) {
      ConvertTo-WindowRecord $matchedWindow
    } else {
      $null
    }
    candidates = $candidateRecords
    candidateCount = $candidateRecords.Count
    candidateLimit = $MaxCandidates
    matchCount = $matches.Count
    totalWindowCount = $ranked.Count
    focusRequested = [bool]$Focus
    reason = $reason
  } | ConvertTo-Json -Depth 5 -Compress
} catch {
  [ordered]@{
    ok = $false
    matched = $null
    candidates = @()
    candidateCount = 0
    candidateLimit = $MaxCandidates
    matchCount = 0
    totalWindowCount = 0
    focusRequested = [bool]$Focus
    reason = $_.Exception.Message
  } | ConvertTo-Json -Depth 5 -Compress
}
