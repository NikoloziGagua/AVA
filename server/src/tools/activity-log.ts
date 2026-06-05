// Read Ava's own activity logs so it can tell Sir what it did or what went wrong.
//
// The server logs as pino JSON lines ({ level, time, msg, … }) to daily-rotated
// files "server.<date>.<n>.log" under the logs dir, already secret-scrubbed on
// write. These pure helpers parse + filter that stream; the reader loads the
// newest file's tail. The agent turns the result into a plain-language account.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface LogEntry {
  time: number;
  level: number;
  msg: string;
}

const LEVEL_NAME: Record<number, string> = {
  10: "trace", 20: "debug", 30: "info", 40: "warn", 50: "error", 60: "fatal",
};

export function parseLogLine(line: string): LogEntry | null {
  const t = line.trim();
  if (!t) return null;
  try {
    const o = JSON.parse(t) as Record<string, unknown>;
    if (typeof o.time !== "number" || typeof o.level !== "number") return null;
    return { time: o.time, level: o.level, msg: typeof o.msg === "string" ? o.msg : "" };
  } catch {
    return null;
  }
}

export interface SelectOpts {
  /** "errors" = warnings + errors only (level ≥ 40); default "all". */
  level?: "all" | "errors";
  /** Case-insensitive keyword the message must contain. */
  contains?: string;
  /** Max entries (default 30, clamped 1..100). */
  limit?: number;
}

export function selectLogEntries(lines: string[], opts: SelectOpts = {}): LogEntry[] {
  const minLevel = opts.level === "errors" ? 40 : 0;
  const needle = (opts.contains ?? "").toLowerCase();
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const out: LogEntry[] = [];
  for (const line of lines) {
    const e = parseLogLine(line);
    if (!e) continue;
    if (e.level < minLevel) continue;
    if (needle && !e.msg.toLowerCase().includes(needle)) continue;
    out.push(e);
  }
  return out.slice(-limit);
}

function hhmmss(time: number): string {
  const d = new Date(time);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function formatLogEntries(entries: LogEntry[]): string {
  if (entries.length === 0) return "No matching activity in the logs.";
  return entries
    .map((e) => `${hhmmss(e.time)} ${LEVEL_NAME[e.level] ?? String(e.level)}: ${e.msg}`)
    .join("\n");
}

function logFileRank(name: string): [string, number] | null {
  const m = name.match(/^server\.(\d{4}-\d{2}-\d{2})\.(\d+)\.log$/);
  return m ? [m[1]!, Number(m[2])] : null;
}

/** Newest "server.<date>.<n>.log" in `dir`, or null if none/unreadable. */
export async function latestLogFile(dir: string): Promise<string | null> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return null;
  }
  const ranked = files
    .map((f) => ({ f, r: logFileRank(f) }))
    .filter((x): x is { f: string; r: [string, number] } => x.r !== null)
    .sort((a, b) => (a.r[0] < b.r[0] ? -1 : a.r[0] > b.r[0] ? 1 : a.r[1] - b.r[1]));
  return ranked.length ? join(dir, ranked[ranked.length - 1]!.f) : null;
}

export async function readRecentLogs(dir: string, opts: SelectOpts = {}): Promise<string> {
  const file = await latestLogFile(dir);
  if (!file) return "No activity logs found yet.";
  let content: string;
  try {
    content = await readFile(file, "utf8");
  } catch {
    return "Could not read the activity log.";
  }
  // Bound the work: only scan the tail of the file.
  const tail = content.split("\n").slice(-4000);
  return formatLogEntries(selectLogEntries(tail, opts));
}
