import { memoryPaths } from "../memory/paths.js";
import { readFile } from "../memory/store.js";
import { autoPruneObservations, SOFT_CAPS } from "../memory/budgets.js";
import { bootstrapMemoryDir } from "../memory/bootstrap.js";
import { TOOL_RUBRIC } from "./tool-rubric.js";
import { CAPABILITIES_MD } from "./capabilities-content.js";

export type BuildSystemPromptOpts = {
  memoryDir: string;
  /** Optional project context layer; appended after the rubric. */
  projectContext?: string;
  /** ISO yyyy-mm-dd; injectable for deterministic tests. Defaults to today. */
  today?: string;
  /**
   * In "conversation" mode the tool rubric is omitted — tools aren't exposed
   * to the model anyway, so the rubric is dead prefill. Each mode is its own
   * cache lane and stays byte-stable within itself.
   */
  mode?: "conversation" | "action";
  /**
   * Allowlisted filesystem roots. Rendered (action mode only) so the agent
   * writes to a path that will actually be accepted instead of guessing one
   * outside the allowlist. Config-fixed, so it stays byte-stable across turns.
   */
  fsRoots?: string[];
};

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function block(label: string, body: string): string {
  const trimmed = body.replace(/\s+$/, "");
  if (!trimmed) return "";
  return `# ${label}\n${trimmed}\n`;
}

function buildFsRootsBlock(roots: string[]): string {
  const list = roots.map((r) => `- ${r}`).join("\n");
  return (
    "# Filesystem access\n" +
    "I read and write files only within these roots — any path outside them is rejected:\n" +
    `${list}\n` +
    "When Sir doesn't say where to put something, I write under one of these (a " +
    "Downloads folder is best for files he'll open). I do not guess paths outside " +
    "them, and if a write is rejected I retry under an allowed root rather than giving up.\n"
  );
}

export function buildSystemPrompt(opts: BuildSystemPromptOpts): string {
  // Defense-in-depth: server start calls bootstrap, but tests and scripts can
  // bypass that path. Bootstrap is idempotent (existsSync-guarded) and cheap.
  bootstrapMemoryDir({ dir: opts.memoryDir });
  const p = memoryPaths(opts.memoryDir);
  const today = opts.today ?? isoToday();

  const persona = readFile(p.personality);
  const memoryIndex = readFile(p.memoryIndex);
  const preferences = readFile(p.preferences);
  const observationsRaw = readFile(p.observations);
  const observations = observationsRaw
    ? autoPruneObservations(observationsRaw, { today, softCap: SOFT_CAPS.observations }).content
    : "";

  const layers: string[] = [];
  if (persona.trim()) layers.push(persona.replace(/\s+$/, "") + "\n");
  // Canonical capability map — present in both modes so Ava recalls its own reach
  // in voice/conversation as well as action. Static text, kept in the stable cache
  // prefix right after the persona.
  layers.push(CAPABILITIES_MD.replace(/\s+$/, "") + "\n");
  if (memoryIndex.trim()) layers.push(block("Memory index", memoryIndex));
  if (preferences.trim()) layers.push(block("Preferences", preferences));
  if (observations.trim()) layers.push(block("Observations", observations));
  if (opts.mode !== "conversation") {
    layers.push(TOOL_RUBRIC);
    if (opts.fsRoots && opts.fsRoots.length) {
      layers.push(buildFsRootsBlock(opts.fsRoots));
    }
  }
  if (opts.projectContext && opts.projectContext.trim()) {
    layers.push(block("Project context", opts.projectContext));
  }

  return layers.join("\n");
}
