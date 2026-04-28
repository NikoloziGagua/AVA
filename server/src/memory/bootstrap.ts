// server/src/memory/bootstrap.ts
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { memoryPaths } from "./paths.js";
import { PERSONALITY_MD } from "./personality-content.js";

export function bootstrapMemoryDir(opts: { dir: string }): void {
  const p = memoryPaths(opts.dir);
  mkdirSync(p.projectsDir, { recursive: true });
  if (!existsSync(p.personality)) {
    writeFileSync(p.personality, PERSONALITY_MD, "utf8");
  }
}
