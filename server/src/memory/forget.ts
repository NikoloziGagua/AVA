import { existsSync, rmSync } from "node:fs";
import type { MemoryPaths } from "./paths.js";
import { readFile, writeFile } from "./store.js";
import { parseObservation } from "./observations.js";

export type ForgetLastResult = { dropped: string | null };

export function forgetLast(opts: { paths: MemoryPaths }): ForgetLastResult {
  const content = readFile(opts.paths.observations);
  const lines = content.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (parseObservation(lines[i]!)) {
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
    if (obs && obs.text.toLowerCase().includes(opts.target.toLowerCase())) matches.push(i);
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

export function forgetProject(opts: { paths: MemoryPaths; slug: string }): ForgetProjectResult {
  const file = opts.paths.projectFile(opts.slug);
  let removedFile = false;
  if (existsSync(file)) { rmSync(file, { force: true }); removedFile = true; }

  for (const path of [opts.paths.preferences, opts.paths.observations]) {
    const content = readFile(path);
    if (!content) continue;
    const filtered = content.split("\n")
      .filter((ln) => !ln.toLowerCase().includes(opts.slug.toLowerCase()))
      .join("\n");
    if (filtered !== content) writeFile(path, filtered);
  }
  return { removedFile };
}
