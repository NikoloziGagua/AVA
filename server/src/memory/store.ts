import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { scrubSecrets } from "../security/scrub.js";

export function readFile(path: string): string {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8");
}

export function writeFile(path: string, content: string): void {
  writeFileSync(path, scrubSecrets(content), "utf8");
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
