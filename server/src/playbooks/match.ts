import type { LLMProvider } from "../orchestrator/llm/types.js";

export async function matchPlaybook(o: {
  prompt: string; index: { slug: string; trigger: string }[]; provider: LLMProvider;
}): Promise<string | null> {
  if (o.index.length === 0) return null;
  const system =
    "You match a user request to ONE saved playbook, or none. " +
    "Reply with ONLY the matching slug exactly, or the word none. No other text.";
  const list = o.index.map((e) => `${e.slug}: ${e.trigger}`).join("\n");
  const user = `Playbooks:\n${list}\n\nRequest: ${o.prompt}`;
  let text = "";
  for await (const ev of o.provider.stream({
    model: o.provider.defaultSideModel, system, messages: [{ role: "user", content: user }],
    tools: [], abort: new AbortController().signal, reasoningEffort: "none",
  })) {
    if (ev.kind === "delta") text += ev.text;
  }
  const slug = text.trim().split(/\s+/)[0] ?? "";
  return o.index.some((e) => e.slug === slug) ? slug : null;
}
