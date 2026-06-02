import type { LLMProvider } from "../orchestrator/llm/types.js";
import { slugify, type Playbook, type Stakes } from "./store.js";

export type RunStep = { tool: string; args: unknown; ok: boolean };

// Tools that change state or take (potentially) irreversible action. A task that
// used any of them is "consequential" → it gets a result-check at recall. Pure
// reads + navigation are "routine". We intentionally do NOT reuse
// policy/classifyRisk: it rates fs_write as "low", which would mislabel writes.
const MUTATING_TOOLS = new Set([
  "fs_write", "fs_delete", "shell", "claude_code", "computer_use",
  "chrome_type", "chrome_press_key", "chrome_click",
  "memory_remember", "memory_forget", "self_improve",
]);

function stakesOf(steps: RunStep[]): Stakes {
  return steps.some((s) => MUTATING_TOOLS.has(s.tool)) ? "consequential" : "routine";
}

export async function distillPlaybook(o: {
  provider: LLMProvider; goal: string; steps: RunStep[]; outcome: string; today: string;
}): Promise<Playbook | null> {
  const system =
    "You distill a completed task into a reusable playbook. Reply with ONLY a JSON object: " +
    '{ "trigger": "<one short line describing the kind of request this handles>", ' +
    '"keywords": ["..."], "steps": ["<high-level step>", ...] }. ' +
    "Steps are the gist of the approach, NOT exact values. No prose outside the JSON.";
  const toolList = o.steps.map((s) => `${s.tool}(${JSON.stringify(s.args)}) -> ${s.ok ? "ok" : "fail"}`).join("\n");
  const user = `Goal: ${o.goal}\n\nTool steps:\n${toolList}\n\nOutcome: ${o.outcome}`;
  let text = "";
  for await (const ev of o.provider.stream({
    model: o.provider.defaultSideModel, system, messages: [{ role: "user", content: user }],
    tools: [], abort: new AbortController().signal, reasoningEffort: "none",
  })) {
    if (ev.kind === "delta") text += ev.text;
  }
  let parsed: { trigger?: string; keywords?: string[]; steps?: string[] };
  try {
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    parsed = JSON.parse(json);
  } catch { return null; }
  if (!parsed.trigger || !Array.isArray(parsed.steps) || parsed.steps.length === 0) return null;
  return {
    slug: slugify(parsed.trigger), trigger: parsed.trigger,
    keywords: (parsed.keywords ?? []).map(String), created: o.today, last_used: o.today,
    uses: 1, stakes: stakesOf(o.steps), steps: parsed.steps.map(String),
  };
}
