import type { LLMProvider } from "../orchestrator/llm/types.js";
import type { SelfKnowledge } from "./identity.js";

export async function reflect(o: {
  provider: LLMProvider; goal: string; knowledge: SelfKnowledge; failureLog: string | null;
}): Promise<string> {
  const system =
    "You are Ava planning a change to your OWN codebase. Produce a concise change brief:\n" +
    "lines starting CHANGE: (what to edit, which files) and ACCEPTANCE: (how a test/build proves it).\n" +
    "Be specific and minimal. Do not write the code; describe the change for a coding worker.\n\n" +
    `REPO: ${o.knowledge.repoRoot}\nTEST: ${o.knowledge.testCmd}\n\n${o.knowledge.body}`;
  const user = o.failureLog
    ? `Goal: ${o.goal}\n\nPrevious attempt failed with:\n${o.failureLog}`
    : `Goal: ${o.goal}`;
  let text = "";
  for await (const ev of o.provider.stream({
    model: o.provider.defaultOrchestratorModel,
    system, messages: [{ role: "user", content: user }], tools: [],
    abort: new AbortController().signal, reasoningEffort: "medium",
  })) {
    if (ev.kind === "delta") text += ev.text;
  }
  return text.trim();
}
