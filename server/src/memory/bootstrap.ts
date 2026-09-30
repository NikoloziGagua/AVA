// server/src/memory/bootstrap.ts
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { memoryPaths } from "./paths.js";
import { PERSONALITY_MD, PREVIOUS_PERSONALITY_TEMPLATES } from "./personality-content.js";

export function bootstrapMemoryDir(opts: { dir: string }): void {
  const p = memoryPaths(opts.dir);
  mkdirSync(p.projectsDir, { recursive: true });
  if (!existsSync(p.personality)) {
    writeFileSync(p.personality, PERSONALITY_MD, "utf8");
    return;
  }
  // An untouched copy of an older shipped template moves to the current one.
  // Any owner edit, however small, leaves the file exactly as it is.
  try {
    const current = readFileSync(p.personality, "utf8").replace(/\r\n/g, "\n");
    if (current !== PERSONALITY_MD && PREVIOUS_PERSONALITY_TEMPLATES.includes(current)) {
      writeFileSync(p.personality, PERSONALITY_MD, "utf8");
    }
  } catch { /* unreadable: leave it for the owner */ }
}
