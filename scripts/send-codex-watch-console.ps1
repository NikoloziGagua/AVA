param(
  [Parameter(Mandatory = $true)]
  [string]$HandoffPath
)

$ErrorActionPreference = 'Stop'

function Write-Result {
  param(
    [Parameter(Mandatory = $true)][string]$Status,
    [Parameter(Mandatory = $true)][string]$Detail,
    [int]$ProcessId = 0,
    [int]$CharacterCount = 0
  )
  [ordered]@{
    status = $Status
    detail = $Detail
    processId = $ProcessId
    characterCount = $CharacterCount
  } | ConvertTo-Json -Compress
}

try {
  $resolvedHandoff = (Resolve-Path -LiteralPath $HandoffPath).Path
  $record = Get-Content -LiteralPath $resolvedHandoff -Raw | ConvertFrom-Json
  if ($record.schemaVersion -ne 1 -or
      $record.watchId -notmatch '^[A-Za-z0-9_-]{1,128}$' -or
      $record.threadId -notmatch '^[A-Za-z0-9_-]{1,128}$' -or
      [string]::IsNullOrWhiteSpace([string]$record.prompt)) {
    Write-Result -Status 'unavailable' -Detail 'The claimed watcher handoff is invalid.'
    exit 10
  }

  # A standalone TUI has no public cross-process queue. Fail closed unless one
  # and only one argument-free Codex TUI exists in this Windows logon session.
  $sessionId = (Get-Process -Id $PID).SessionId
  $codex = @(Get-CimInstance Win32_Process -Filter "Name='codex.exe'" | Where-Object {
    try {
      $process = Get-Process -Id $_.ProcessId -ErrorAction Stop
      $command = ([string]$_.CommandLine).Trim()
      $argumentFreeTui = $command -match '^(?:"[^"]*\\codex(?:\.exe)?"|codex(?:\.exe)?)$'
      $process.SessionId -eq $sessionId -and $argumentFreeTui
    } catch {
      $false
    }
  })
  if ($codex.Count -ne 1) {
    Write-Result -Status 'unavailable' -Detail "Expected one standalone Codex TUI in this logon session; found $($codex.Count)."
    exit 10
  }

  $prompt = [regex]::Replace(([string]$record.prompt).Replace([string][char]0, ''), '\s+', ' ').Trim()
  if ($prompt.Length -eq 0 -or $prompt.Length -gt 65536) {
    Write-Result -Status 'unavailable' -Detail 'The watcher prompt is empty or exceeds the console delivery limit.'
    exit 10
  }

  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class AvaCodexConsoleInput
{
    private const ushort KEY_EVENT = 0x0001;
    private const ushort VK_TAB = 0x09;
    private const uint GENERIC_READ = 0x80000000;
    private const uint GENERIC_WRITE = 0x40000000;
    private const uint FILE_SHARE_READ = 0x00000001;
    private const uint FILE_SHARE_WRITE = 0x00000002;
    private const uint OPEN_EXISTING = 3;

    [StructLayout(LayoutKind.Explicit, CharSet = CharSet.Unicode)]
    private struct KEY_EVENT_RECORD
    {
        [FieldOffset(0), MarshalAs(UnmanagedType.Bool)] public bool KeyDown;
        [FieldOffset(4)] public ushort RepeatCount;
        [FieldOffset(6)] public ushort VirtualKeyCode;
        [FieldOffset(8)] public ushort VirtualScanCode;
        [FieldOffset(10)] public char UnicodeChar;
        [FieldOffset(12)] public uint ControlKeyState;
    }

    [StructLayout(LayoutKind.Explicit, CharSet = CharSet.Unicode)]
    private struct INPUT_RECORD
    {
        [FieldOffset(0)] public ushort EventType;
        [FieldOffset(4)] public KEY_EVENT_RECORD KeyEvent;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool FreeConsole();

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AttachConsole(uint processId);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern SafeFileHandle CreateFileW(
        string fileName,
        uint desiredAccess,
        uint shareMode,
        IntPtr securityAttributes,
        uint creationDisposition,
        uint flagsAndAttributes,
        IntPtr templateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool WriteConsoleInputW(
        SafeFileHandle consoleInput,
        INPUT_RECORD[] buffer,
        uint length,
        out uint written);

    private static INPUT_RECORD Key(char value, ushort virtualKey, bool down)
    {
        return new INPUT_RECORD {
            EventType = KEY_EVENT,
            KeyEvent = new KEY_EVENT_RECORD {
                KeyDown = down,
                RepeatCount = 1,
                VirtualKeyCode = virtualKey,
                VirtualScanCode = 0,
                UnicodeChar = value,
                ControlKeyState = 0
            }
        };
    }

    // Returns OK, PREWRITE:<win32>, or PARTIAL:<events>:<win32>. A partial
    // write is deliberately ambiguous and must never be automatically retried.
    public static string SendAndQueue(uint processId, string text)
    {
        FreeConsole();
        if (!AttachConsole(processId)) return "PREWRITE:" + Marshal.GetLastWin32Error();
        using (SafeFileHandle input = CreateFileW(
            "CONIN$",
            GENERIC_READ | GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            IntPtr.Zero,
            OPEN_EXISTING,
            0,
            IntPtr.Zero))
        {
            if (input.IsInvalid) return "PREWRITE:" + Marshal.GetLastWin32Error();
            int total = 0;
            const int CharactersPerBatch = 256;
            for (int offset = 0; offset < text.Length; offset += CharactersPerBatch)
            {
                int count = Math.Min(CharactersPerBatch, text.Length - offset);
                INPUT_RECORD[] records = new INPUT_RECORD[count * 2];
                for (int i = 0; i < count; i++)
                {
                    records[i * 2] = Key(text[offset + i], 0, true);
                    records[i * 2 + 1] = Key(text[offset + i], 0, false);
                }
                uint written;
                if (!WriteConsoleInputW(input, records, (uint)records.Length, out written) || written != records.Length)
                    return "PARTIAL:" + total + ":" + Marshal.GetLastWin32Error();
                total += (int)written;
            }

            INPUT_RECORD[] queueKey = new INPUT_RECORD[] {
                Key('\t', VK_TAB, true),
                Key('\t', VK_TAB, false)
            };
            uint queueWritten;
            if (!WriteConsoleInputW(input, queueKey, 2, out queueWritten) || queueWritten != 2)
                return "PARTIAL:" + total + ":" + Marshal.GetLastWin32Error();
            return "OK";
        }
    }
}
'@

  $processId = [int]$codex[0].ProcessId
  $nativeResult = [AvaCodexConsoleInput]::SendAndQueue([uint32]$processId, $prompt)
  if ($nativeResult -eq 'OK') {
    Write-Result -Status 'injected' -Detail 'The watcher prompt was submitted through the standalone TUI input boundary.' -ProcessId $processId -CharacterCount $prompt.Length
    exit 0
  }
  if ($nativeResult.StartsWith('PREWRITE:')) {
    Write-Result -Status 'unavailable' -Detail "The standalone TUI console could not be opened ($nativeResult)." -ProcessId $processId
    exit 10
  }
  Write-Result -Status 'ambiguous' -Detail "Console delivery became uncertain after input started ($nativeResult); automatic replay is disabled." -ProcessId $processId
  exit 20
} catch {
  Write-Result -Status 'unavailable' -Detail $_.Exception.Message
  exit 10
}
