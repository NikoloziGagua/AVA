// Windows desktop screenshot capture.
//
// Captures the current desktop to a PNG under
// `%USERPROFILE%\Downloads\Ava\screenshots\` and returns structured metadata.
//
// Security: the model never gets to write to an arbitrary path. If a `path`
// argument is supplied it must resolve INSIDE the screenshots directory, or the
// capture is rejected before any backend runs. The default (no path) generates a
// timestamped filename inside that same directory.

import { promises as fsp } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, normalize, extname, dirname } from "node:path";
import { spawn } from "node:child_process";

export type ScreenshotOk = {
  ok: true;
  path: string;
  mimeType: string;
  bytes: number;
};

export type ScreenshotErr = {
  ok: false;
  error: { code: ScreenshotErrorCode; message: string };
};

export type ScreenshotResult = ScreenshotOk | ScreenshotErr;

export type ScreenshotErrorCode =
  | "disallowed_path"
  | "capture_failed"
  | "write_failed";

/** Injectable capture backend: write a PNG of the desktop to `outPath`. */
export type CaptureFn = (outPath: string) => Promise<void>;

/** PNG file signature (first 8 bytes). */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The single allowed output directory for screenshots. */
export function screenshotDir(home: string = homedir()): string {
  return join(home, "Downloads", "Ava", "screenshots");
}

/** Resolve+normalize a path to a forward-slash form for prefix comparison. */
function norm(p: string): string {
  return normalize(resolve(p)).replace(/\\/g, "/").replace(/\/+$/, "");
}

/** True iff `target` resolves inside `dir` (or equals it). */
function isInside(dir: string, target: string): boolean {
  const d = norm(dir);
  const t = norm(target);
  return t === d || t.startsWith(d + "/");
}

export type TakeScreenshotOpts = {
  /** Optional explicit output path — must resolve inside the screenshots dir. */
  path?: string;
  /** Override the capture backend (tests inject a fake). */
  capture?: CaptureFn;
  /** Override the base directory (tests point this at a temp dir). */
  baseDir?: string;
  /** Monotonic stamp for the default filename; defaults to Date.now(). */
  now?: number;
};

/**
 * Capture the desktop to a PNG and return its path + metadata.
 *
 * Always resolves (never throws): backend or write failures come back as a
 * structured `{ ok: false, error }` result so the orchestrator can speak a clear
 * message instead of crashing the turn.
 */
export async function takeScreenshot(opts: TakeScreenshotOpts = {}): Promise<ScreenshotResult> {
  const dir = opts.baseDir ?? screenshotDir();
  const capture = opts.capture ?? captureWindowsDesktop;

  // Resolve the target path and enforce that it stays inside the allowed dir.
  let outPath: string;
  if (opts.path != null && opts.path !== "") {
    if (!isInside(dir, opts.path)) {
      return {
        ok: false,
        error: {
          code: "disallowed_path",
          message: `output path must be inside ${dir}`,
        },
      };
    }
    outPath = resolve(opts.path);
    if (extname(outPath).toLowerCase() !== ".png") {
      return {
        ok: false,
        error: { code: "disallowed_path", message: "output path must end in .png" },
      };
    }
  } else {
    const stamp = opts.now ?? Date.now();
    outPath = join(dir, `screenshot-${stamp}.png`);
  }

  // Create the output file's directory if needed (the allowlist already confirmed
  // it resolves inside `dir`). A failure here is a write failure.
  try {
    await fsp.mkdir(dirname(outPath), { recursive: true });
  } catch (e) {
    return { ok: false, error: { code: "write_failed", message: errMsg(e) } };
  }

  // Run the capture backend.
  try {
    await capture(outPath);
  } catch (e) {
    return { ok: false, error: { code: "capture_failed", message: errMsg(e) } };
  }

  // Verify the file landed and looks like a PNG.
  try {
    const buf = await fsp.readFile(outPath);
    if (buf.length < PNG_MAGIC.length || !buf.subarray(0, 8).equals(PNG_MAGIC)) {
      return {
        ok: false,
        error: { code: "capture_failed", message: "captured file is not a valid PNG" },
      };
    }
    return { ok: true, path: outPath, mimeType: "image/png", bytes: buf.length };
  } catch (e) {
    return { ok: false, error: { code: "write_failed", message: errMsg(e) } };
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Default backend: capture the full virtual desktop via PowerShell + System.Drawing
 * and save it as a PNG. No native dependency required on Windows.
 */
export function captureWindowsDesktop(outPath: string): Promise<void> {
  const target = outPath.replace(/'/g, "''");
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms,System.Drawing;",
    "$vs = [System.Windows.Forms.SystemInformation]::VirtualScreen;",
    "$bmp = New-Object System.Drawing.Bitmap $vs.Width, $vs.Height;",
    "$g = [System.Drawing.Graphics]::FromImage($bmp);",
    "$g.CopyFromScreen($vs.X, $vs.Y, 0, 0, $bmp.Size);",
    `$bmp.Save('${target}', [System.Drawing.Imaging.ImageFormat]::Png);`,
    "$g.Dispose(); $bmp.Dispose();",
  ].join(" ");

  return new Promise<void>((res, rej) => {
    const ps = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true },
    );
    let stderr = "";
    ps.stderr.on("data", (d) => { stderr += String(d); });
    ps.on("error", rej);
    ps.on("close", (code) => {
      if (code === 0) res();
      else rej(new Error(`powershell capture exited ${code}: ${stderr.trim()}`));
    });
  });
}
