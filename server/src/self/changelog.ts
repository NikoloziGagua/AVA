import { join } from "node:path";
import { readFile, writeFile } from "../memory/store.js";

// Ava's self-evolution record. On every shipped self-improvement we append one
// line of "what changed / what I now do" — so Ava stays aware of itself cheaply
// (no re-reading the codebase) and can hand recent history to Claude so it
// doesn't undo past fixes.

const file = (memoryDir: string) => join(memoryDir, "changelog.md");
const HEADER = "# Ava self-improvement changelog\n\n";

export function appendChangelog(memoryDir: string, e: { summary: string; commit?: string; date?: string }): void {
  const date = e.date ?? new Date().toISOString().slice(0, 10);
  const prior = readFile(file(memoryDir)) || HEADER;
  const line = `- ${date}${e.commit ? ` (${e.commit.slice(0, 8)})` : ""}: ${e.summary}\n`;
  writeFile(file(memoryDir), prior + line);
}

/** The most recent change lines (for context to Claude / for Ava's self-view). */
export function readChangelog(memoryDir: string, limit = 30): string {
  const c = readFile(file(memoryDir)) || "";
  const lines = c.split("\n").filter((l) => l.startsWith("- "));
  return lines.slice(-limit).join("\n");
}
