import { existsSync, readFileSync, writeFileSync, appendFileSync, renameSync } from "node:fs";
import { scrubSecrets } from "../security/scrub.js";

export function readFile(path: string): string {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8");
}

export function writeFile(path: string, content: string): void {
  // Atomic write (tmp + rename): a crash mid-write must never truncate a memory
  // file — observations/preferences are Ava's only durable memory.
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, scrubSecrets(content), "utf8");
  renameSync(tmp, path);
}

export function appendLine(path: string, line: string): void {
  const safe = scrubSecrets(line);
  if (!existsSync(path)) {
    writeFileSync(path, safe + "\n", "utf8");
    return;
  }
  const existing = readFileSync(path, "utf8");
  const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  appendFileSync(path, prefix + safe + "\n", "utf8");
}
