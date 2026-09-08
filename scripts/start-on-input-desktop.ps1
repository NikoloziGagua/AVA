# Reusable Windows launcher for AVA processes that must interact with the
# owner's real desktop. Codex runs commands on an isolated WinSta0 desktop, so
# ordinary Start-Process/ShellExecute inherits CodexSandboxDesktop-* and creates
# windows that Windows calls "visible" but the owner cannot see.

if (-not ("AvaInputDesktopProcess" -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class AvaInputDesktopProcess {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcess(
        string applicationName,
        StringBuilder commandLine,
        IntPtr processAttributes,
        IntPtr threadAttributes,
        bool inheritHandles,
        uint creationFlags,
        IntPtr environment,
        string currentDirectory,
        ref StartupInfo startupInfo,
        out ProcessInformation processInformation
    );

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

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
    private static extern IntPtr GetShellWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(
        uint desiredAccess,
        bool inheritHandle,
        uint processId
    );

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(
        IntPtr process,
        uint desiredAccess,
        out IntPtr token
    );

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool DuplicateTokenEx(
        IntPtr existingToken,
        uint desiredAccess,
        IntPtr tokenAttributes,
        int impersonationLevel,
        int tokenType,
        out IntPtr newToken
    );

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcessWithTokenW(
        IntPtr token,
        uint logonFlags,
        string applicationName,
        StringBuilder commandLine,
        uint creationFlags,
        IntPtr environment,
        string currentDirectory,
        ref StartupInfo startupInfo,
        out ProcessInformation processInformation
    );

    private static string Quote(string value) {
        if (value.Length > 0 &&
            value.IndexOfAny(new char[] { ' ', '\t', '\n', '\v', '"' }) < 0) {
            return value;
        }

        StringBuilder quoted = new StringBuilder();
        quoted.Append('"');
        int slashes = 0;
        foreach (char ch in value) {
            if (ch == '\\') {
                slashes++;
                continue;
            }
            if (ch == '"') {
                quoted.Append('\\', slashes * 2 + 1);
                quoted.Append('"');
                slashes = 0;
                continue;
            }
            quoted.Append('\\', slashes);
            slashes = 0;
            quoted.Append(ch);
        }
        quoted.Append('\\', slashes * 2);
        quoted.Append('"');
        return quoted.ToString();
    }

    private static string CurrentDesktopName() {
        IntPtr desktop = GetThreadDesktop(GetCurrentThreadId());
        int needed;
        GetUserObjectInformation(desktop, 2, null, 0, out needed);
        if (needed <= 0) return "";
        StringBuilder name = new StringBuilder(needed / 2 + 1);
        return GetUserObjectInformation(desktop, 2, name, needed, out needed)
            ? name.ToString()
            : "";
    }

    public static int Start(
        string filePath,
        string[] arguments,
        string workingDirectory,
        bool noWindow
    ) {
        StringBuilder command = new StringBuilder(Quote(filePath));
        foreach (string argument in arguments ?? new string[0]) {
            command.Append(' ');
            command.Append(Quote(argument ?? ""));
        }

        StartupInfo startup = new StartupInfo();
        startup.cb = Marshal.SizeOf(typeof(StartupInfo));
        startup.lpDesktop = @"winsta0\default";
        startup.dwFlags = 0x00000001; // STARTF_USESHOWWINDOW
        startup.wShowWindow = (short)(noWindow ? 0 : 1); // SW_HIDE / SW_SHOWNORMAL

        // Use the token of the real Windows shell. A plain CreateProcess call
        // inherits Codex's isolated desktop token and Windows silently places
        // the child back on CodexSandboxDesktop-* even when lpDesktop says
        // Default.
        IntPtr shellWindow = GetShellWindow();
        uint shellPid = 0;
        if (shellWindow != IntPtr.Zero) {
            GetWindowThreadProcessId(shellWindow, out shellPid);
        }
        // Isolated desktops intentionally hide GetShellWindow(). Explorer is
        // still visible in the process table, so resolve the oldest Explorer in
        // this logon session as the real signed-in shell.
        if (shellPid == 0) {
            int sessionId = Process.GetCurrentProcess().SessionId;
            DateTime oldest = DateTime.MaxValue;
            foreach (Process candidate in Process.GetProcessesByName("explorer")) {
                try {
                    if (candidate.SessionId == sessionId && candidate.StartTime < oldest) {
                        shellPid = (uint)candidate.Id;
                        oldest = candidate.StartTime;
                    }
                } catch {
                    // Ignore an inaccessible candidate.
                } finally {
                    candidate.Dispose();
                }
            }
        }
        if (shellPid == 0) {
            throw new Win32Exception("Could not identify Explorer in the signed-in session.");
        }

        IntPtr shellProcess = OpenProcess(0x1000, false, shellPid);
        if (shellProcess == IntPtr.Zero) {
            throw new Win32Exception(
                Marshal.GetLastWin32Error(),
                "Could not open the signed-in Explorer process"
            );
        }

        IntPtr shellToken = IntPtr.Zero;
        IntPtr primaryToken = IntPtr.Zero;
        try {
            const uint TOKEN_ACCESS = 0x0001 | 0x0002 | 0x0008;
            if (!OpenProcessToken(shellProcess, TOKEN_ACCESS, out shellToken)) {
                throw new Win32Exception(
                    Marshal.GetLastWin32Error(),
                    "Could not read the signed-in Explorer token"
                );
            }
            if (!DuplicateTokenEx(
                shellToken,
                TOKEN_ACCESS,
                IntPtr.Zero,
                2,
                1,
                out primaryToken
            )) {
                throw new Win32Exception(
                    Marshal.GetLastWin32Error(),
                    "Could not duplicate the signed-in Explorer token"
                );
            }

            uint flags = noWindow ? 0x08000000u : 0u; // CREATE_NO_WINDOW
            ProcessInformation process;
            if (!CreateProcessWithTokenW(
                primaryToken,
                1,
                filePath,
                command,
                flags,
                IntPtr.Zero,
                workingDirectory,
                ref startup,
                out process
            )) {
                int error = Marshal.GetLastWin32Error();
                // A standard interactive task already has the correct user
                // token and Default desktop. It does not hold SeImpersonate
                // (1314), nor does it need to: direct CreateProcess is correct
                // from that context.
                if (error == 1314 &&
                    CurrentDesktopName().Equals(
                        "Default",
                        StringComparison.OrdinalIgnoreCase
                    )) {
                    StringBuilder directCommand = new StringBuilder(command.ToString());
                    if (!CreateProcess(
                        filePath,
                        directCommand,
                        IntPtr.Zero,
                        IntPtr.Zero,
                        false,
                        flags,
                        IntPtr.Zero,
                        workingDirectory,
                        ref startup,
                        out process
                    )) {
                        int directError = Marshal.GetLastWin32Error();
                        throw new Win32Exception(
                            directError,
                            "Could not launch directly from the interactive " +
                            "Default desktop (Win32 " + directError + ")"
                        );
                    }
                } else {
                throw new Win32Exception(
                    error,
                    "Could not launch with the signed-in Explorer token on " +
                    "winsta0\\default (Win32 " + error + ")"
                );
                }
            }

            try { return process.dwProcessId; }
            finally {
                CloseHandle(process.hThread);
                CloseHandle(process.hProcess);
            }
        } finally {
            if (primaryToken != IntPtr.Zero) CloseHandle(primaryToken);
            if (shellToken != IntPtr.Zero) CloseHandle(shellToken);
            CloseHandle(shellProcess);
        }
    }
}
"@
}

function Start-OnInputDesktop {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [string[]]$ArgumentList = @(),
    [string]$WorkingDirectory = "",
    [switch]$NoWindow
  )

  $resolvedFile = (Resolve-Path -LiteralPath $FilePath).Path
  if (-not $WorkingDirectory) {
    $WorkingDirectory = Split-Path -Parent $resolvedFile
  }
  [AvaInputDesktopProcess]::Start(
    $resolvedFile,
    $ArgumentList,
    $WorkingDirectory,
    [bool]$NoWindow
  )
}
