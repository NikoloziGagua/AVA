param([int]$Port = 9222)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class AvaDesktopDiagnostic {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    public struct Rect {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    public sealed class WindowInfo {
        public long Handle;
        public int Pid;
        public int ThreadId;
        public bool Visible;
        public bool Iconic;
        public int Cloaked;
        public string ClassName = "";
        public string Title = "";
        public string Desktop = "";
        public Rect Bounds;
    }

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    private static extern IntPtr GetProcessWindowStation();

    [DllImport("user32.dll")]
    private static extern IntPtr GetThreadDesktop(uint threadId);

    [DllImport("user32.dll")]
    private static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint desiredAccess);

    [DllImport("user32.dll")]
    private static extern bool CloseDesktop(IntPtr desktop);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetUserObjectInformation(
        IntPtr handle,
        int index,
        StringBuilder info,
        int length,
        out int needed
    );

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder className, int maxCount);

    [DllImport("user32.dll")]
    private static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out Rect rect);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(
        IntPtr hWnd,
        int attribute,
        out int value,
        int valueSize
    );

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

    public static string CurrentWindowStation() {
        return ObjectName(GetProcessWindowStation());
    }

    public static string CurrentDesktop() {
        return ObjectName(GetThreadDesktop(GetCurrentThreadId()));
    }

    public static string InputDesktop() {
        const uint DESKTOP_READOBJECTS = 0x0001;
        IntPtr desktop = OpenInputDesktop(0, false, DESKTOP_READOBJECTS);
        if (desktop == IntPtr.Zero) return "";
        try { return ObjectName(desktop); }
        finally { CloseDesktop(desktop); }
    }

    public static WindowInfo[] WindowsForPid(int pid) {
        List<WindowInfo> windows = new List<WindowInfo>();
        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
            uint owner;
            uint threadId = GetWindowThreadProcessId(hWnd, out owner);
            if (owner != (uint)pid) return true;

            StringBuilder className = new StringBuilder(256);
            GetClassName(hWnd, className, className.Capacity);
            int titleLength = GetWindowTextLength(hWnd);
            StringBuilder title = new StringBuilder(Math.Max(titleLength + 1, 2));
            GetWindowText(hWnd, title, title.Capacity);
            Rect bounds;
            GetWindowRect(hWnd, out bounds);
            int cloaked = -1;
            DwmGetWindowAttribute(hWnd, 14, out cloaked, sizeof(int));

            windows.Add(new WindowInfo {
                Handle = hWnd.ToInt64(),
                Pid = pid,
                ThreadId = (int)threadId,
                Visible = IsWindowVisible(hWnd),
                Iconic = IsIconic(hWnd),
                Cloaked = cloaked,
                ClassName = className.ToString(),
                Title = title.ToString(),
                Desktop = ObjectName(GetThreadDesktop(threadId)),
                Bounds = bounds
            });
            return true;
        }, IntPtr.Zero);
        return windows.ToArray();
    }
}
"@

$browserPid = 0
$pattern = "127\.0\.0\.1:$Port\s+.*LISTENING\s+(\d+)\s*$"
foreach ($line in (netstat -ano -p tcp)) {
  if ($line -match $pattern) {
    $browserPid = [int]$Matches[1]
    break
  }
}

$explorer = Get-Process explorer -ErrorAction SilentlyContinue |
  Sort-Object StartTime |
  Select-Object -First 1

[ordered]@{
  processId = $PID
  sessionId = (Get-Process -Id $PID).SessionId
  windowStation = [AvaDesktopDiagnostic]::CurrentWindowStation()
  desktop = [AvaDesktopDiagnostic]::CurrentDesktop()
  inputDesktop = [AvaDesktopDiagnostic]::InputDesktop()
  explorerPid = $explorer.Id
  explorerSessionId = $explorer.SessionId
  browserPid = $browserPid
  browserSessionId = $(if ($browserPid) { (Get-Process -Id $browserPid).SessionId } else { $null })
  browserWindows = @(
    if ($browserPid) {
      [AvaDesktopDiagnostic]::WindowsForPid($browserPid)
    }
  )
} | ConvertTo-Json -Depth 6 -Compress
