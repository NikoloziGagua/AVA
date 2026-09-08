import { memoryPaths } from "../memory/paths.js";
import { readFile } from "../memory/store.js";
import { autoPruneObservations, SOFT_CAPS } from "../memory/budgets.js";
import { bootstrapMemoryDir } from "../memory/bootstrap.js";
import { TOOL_RUBRIC } from "./tool-rubric.js";
import { CAPABILITIES_MD } from "./capabilities-content.js";
import {
  PERSONA_COLLABORATION_CONTRACT,
  PERSONA_REGISTER_GUIDE,
  buildActivePersonaRegister,
  type PersonaChannel,
} from "../persona/runtime.js";

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
   * Compact build for the Hume voice prompt, which has a hard ~12k truncation
   * budget. Omits the big capability map + memory index (dead weight when the
   * model can't run tools anyway) so persona/prefs/observations fit. Identity and
   * recollection are layered ahead of this by the caller.
   */
  compact?: boolean;
  /**
   * Allowlisted filesystem roots. Rendered (action mode only) so the agent
   * writes to a path that will actually be accepted instead of guessing one
   * outside the allowlist. Config-fixed, so it stays byte-stable across turns.
   */
  fsRoots?: string[];
  /** Closed-enum delivery context derived from the literal current user turn. */
  personaContext?: { userText: string; channel: PersonaChannel };
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
  // Layer order is cache-aware: ALL static text (persona, capability map, memory
  // index, tool rubric, fsRoots) comes first; the mutable layers (preferences,
  // observations — appended to by memory_remember mid-session) come after, so a
  // memory write invalidates only the tail of the prompt-cache prefix instead of
  // busting the ~6k chars of static rubric that used to sit behind observations.
  if (persona.trim()) layers.push(persona.replace(/\s+$/, "") + "\n");
  // Identity, collaboration and context selection are deliberately separate.
  // The latter two are code-owned behavioral guidance and cannot grant tools or
  // permissions. Keeping them static here preserves the prompt-cache prefix.
  layers.push(PERSONA_COLLABORATION_CONTRACT);
  layers.push(PERSONA_REGISTER_GUIDE);
  // Canonical capability map — present in both modes so Ava recalls its own reach
  // in voice/conversation as well as action. Skipped in `compact` (Hume voice) —
  // the model there can't run tools, so the 4.4k map is dead prefill.
  if (!opts.compact) layers.push(CAPABILITIES_MD.replace(/\s+$/, "") + "\n");
  if (!opts.compact && memoryIndex.trim()) layers.push(block("Memory index", memoryIndex));
  if (opts.mode !== "conversation") {
    layers.push(TOOL_RUBRIC);
    if (opts.fsRoots && opts.fsRoots.length) {
      layers.push(buildFsRootsBlock(opts.fsRoots));
    }
  }
  if (preferences.trim()) layers.push(block("Preferences", preferences));
  if (observations.trim()) layers.push(block("Observations", observations));
  if (opts.projectContext && opts.projectContext.trim()) {
    layers.push(block("Project context", opts.projectContext));
  }
  // Only the selected register is dynamic. Raw user text never enters this
  // system layer; it selects one closed enum and remains a normal user message.
  if (opts.personaContext) {
    layers.push(buildActivePersonaRegister({
      text: opts.personaContext.userText,
      channel: opts.personaContext.channel,
    }));
  }

  return layers.join("\n");
}
