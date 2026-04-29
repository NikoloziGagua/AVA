import { memoryPaths } from "./paths.js";
import { readFile, writeFile, appendLine } from "./store.js";

export type EditableFile = "preferences" | "observations";

function pathFor(memoryDir: string, file: EditableFile): string {
  const p = memoryPaths(memoryDir);
  return file === "preferences" ? p.preferences : p.observations;
}

export type EditResult =
  | { kind: "ok" }
  | { kind: "stale"; current: string };

export type EditOpts = {
  memoryDir: string;
  file: EditableFile;
  oldLine: string;
  newLine: string;
};

export function editLine(opts: EditOpts): EditResult {
  const path = pathFor(opts.memoryDir, opts.file);
  const body = readFile(path);
  const lines = body.split("\n");
  const idx = lines.indexOf(opts.oldLine);
  if (idx < 0) return { kind: "stale", current: body };
  lines[idx] = opts.newLine;
  writeFile(path, lines.join("\n"));
  return { kind: "ok" };
}

export type DeleteOpts = {
  memoryDir: string;
  file: EditableFile;
  oldLine: string;
};

export function deleteLine(opts: DeleteOpts): EditResult {
  const path = pathFor(opts.memoryDir, opts.file);
  const body = readFile(path);
  const lines = body.split("\n");
  const idx = lines.indexOf(opts.oldLine);
  if (idx < 0) return { kind: "stale", current: body };
  lines.splice(idx, 1);
  writeFile(path, lines.join("\n"));
  return { kind: "ok" };
}

export function appendLineTo(opts: {
  memoryDir: string; file: "preferences"; line: string;
}): void {
  const p = memoryPaths(opts.memoryDir);
  appendLine(p.preferences, opts.line);
}
