import { randomUUID } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";

export type ServerLock = {
  path: string;
  pid: number;
  instanceId: string;
  release: () => void;
};

type LockRecord = { pid: number; instanceId: string; createdAt: number };

function productionPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM still means a process exists but cannot be signalled. Only ESRCH is
    // reliable evidence that the recorded owner has gone away.
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function readRecord(path: string): LockRecord | null {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<LockRecord>;
    if (!Number.isInteger(value.pid) || Number(value.pid) <= 0 || typeof value.instanceId !== "string") return null;
    return { pid: Number(value.pid), instanceId: value.instanceId, createdAt: Number(value.createdAt) || 0 };
  } catch {
    return null;
  }
}

/**
 * Acquire AVA's process-level singleton before touching shared boot credentials.
 *
 * Windows can briefly report a successful Node listen callback to a competing
 * process before its EADDRINUSE exit. Port callbacks alone are therefore not a
 * safe ownership boundary. This atomic file claim makes every losing AVA boot
 * exit before it can rotate the healthy process's loopback tokens.
 */
export function acquireServerLock(
  path: string,
  options: { pid?: number; now?: number; isPidAlive?: (pid: number) => boolean } = {},
): ServerLock {
  mkdirSync(dirname(path), { recursive: true });
  const pid = options.pid ?? process.pid;
  const now = options.now ?? Date.now();
  const isPidAlive = options.isPidAlive ?? productionPidAlive;
  const instanceId = randomUUID();
  const record: LockRecord = { pid, instanceId, createdAt: now };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(path, "wx");
      try {
        writeSync(fd, JSON.stringify(record), undefined, "utf8");
      } finally {
        closeSync(fd);
      }
      return {
        path,
        pid,
        instanceId,
        release: () => {
          const current = readRecord(path);
          if (current?.instanceId === instanceId) rmSync(path, { force: true });
        },
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      const existing = readRecord(path);
      if (existing && isPidAlive(existing.pid)) {
        throw new Error(`AVA server is already running as PID ${existing.pid}`);
      }
      // An empty/partial lock can only exist during the tiny synchronous write
      // window. Treat a recent one as owned instead of deleting a live claim.
      if (!existing) {
        try {
          if (now - statSync(path).mtimeMs < 5_000) throw new Error("AVA server lock is being acquired by another process");
        } catch (statError) {
          if (statError instanceof Error && statError.message.includes("being acquired")) throw statError;
        }
      }
      rmSync(path, { force: true });
    }
  }
  throw new Error("could not acquire AVA server lock");
}
