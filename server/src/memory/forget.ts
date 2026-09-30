import { existsSync, rmSync } from "node:fs";
import type { MemoryPaths } from "./paths.js";
import { readFile, writeFile } from "./store.js";
import { parseObservation } from "./observations.js";

export type ForgetLastResult = { dropped: string | null };

export function forgetLast(opts: { paths: MemoryPaths }): ForgetLastResult {
  const content = readFile(opts.paths.observations);
  const lines = content.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const obs = parseObservation(lines[i]!);
    if (obs && !obs.superseded) {
      const dropped = lines[i]!;
      lines.splice(i, 1);
      writeFile(opts.paths.observations, lines.join("\n"));
      return { dropped };
    }
  }
  return { dropped: null };
}

export type ForgetMatchResult =
  | { status: "dropped"; line: string }
  | { status: "ambiguous"; candidates: string[] }
  | { status: "not_found" };

export function forgetMatch(opts: { paths: MemoryPaths; target: string }): ForgetMatchResult {
  const content = readFile(opts.paths.observations);
  const lines = content.split("\n");
  const matches: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const obs = parseObservation(lines[i]!);
    if (obs && !obs.superseded && obs.text.toLowerCase().includes(opts.target.toLowerCase())) matches.push(i);
  }
  if (matches.length === 0) return { status: "not_found" };
  if (matches.length > 1) {
    return { status: "ambiguous", candidates: matches.map((i) => lines[i]!) };
  }
  const line = lines[matches[0]!]!;
  lines.splice(matches[0]!, 1);
  writeFile(opts.paths.observations, lines.join("\n"));
  return { status: "dropped", line };
}

export type ForgetProjectResult = { removedFile: boolean };

// Slug grammar (paths.ts SLUG_RE) is `[a-z0-9][a-z0-9_-]*`, all regex-safe — no
// escape needed. Token boundaries reject neighbouring `[a-zA-Z0-9_-]` so
// slug "yov" doesn't fire on "yovlisshemdzle" and "low" doesn't fire on
// "low-power".
function slugTokenRe(slug: string): RegExp {
  return new RegExp(`(?<![a-zA-Z0-9_-])${slug}(?![a-zA-Z0-9_-])`, "i");
}

export function forgetProject(opts: { paths: MemoryPaths; slug: string }): ForgetProjectResult {
  const file = opts.paths.projectFile(opts.slug);
  let removedFile = false;
  if (existsSync(file)) { rmSync(file, { force: true }); removedFile = true; }

  const re = slugTokenRe(opts.slug);

  const indexContent = readFile(opts.paths.memoryIndex);
  if (indexContent) {
    const filtered = indexContent.split("\n")
      .filter((ln) => !re.test(ln))
      .join("\n");
    if (filtered !== indexContent) writeFile(opts.paths.memoryIndex, filtered);
  }

  const prefContent = readFile(opts.paths.preferences);
  if (prefContent) {
    const filtered = prefContent.split("\n")
      .filter((ln) => !re.test(ln))
      .join("\n");
    if (filtered !== prefContent) writeFile(opts.paths.preferences, filtered);
  }

  const obsContent = readFile(opts.paths.observations);
  if (obsContent) {
    const filtered = obsContent.split("\n")
      .filter((ln) => {
        const obs = parseObservation(ln);
        if (obs) return !re.test(obs.text);
        return !re.test(ln);
      })
      .join("\n");
    if (filtered !== obsContent) writeFile(opts.paths.observations, filtered);
  }
  return { removedFile };
}
