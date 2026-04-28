import { memoryPaths } from "../memory/paths.js";
import { readFile } from "../memory/store.js";
import { autoPruneObservations, SOFT_CAPS } from "../memory/budgets.js";
import { TOOL_RUBRIC } from "./tool-rubric.js";

export type BuildSystemPromptOpts = {
  memoryDir: string;
  /** Optional project context layer; appended after the rubric. */
  projectContext?: string;
  /** ISO yyyy-mm-dd; injectable for deterministic tests. Defaults to today. */
  today?: string;
};

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function block(label: string, body: string): string {
  const trimmed = body.replace(/\s+$/, "");
  if (!trimmed) return "";
  return `# ${label}\n${trimmed}\n`;
}

export function buildSystemPrompt(opts: BuildSystemPromptOpts): string {
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
  if (memoryIndex.trim()) layers.push(block("Memory index", memoryIndex));
  if (preferences.trim()) layers.push(block("Preferences", preferences));
  if (observations.trim()) layers.push(block("Observations", observations));
  layers.push(TOOL_RUBRIC);
  if (opts.projectContext && opts.projectContext.trim()) {
    layers.push(block("Project context", opts.projectContext));
  }

  return layers.join("\n");
}
