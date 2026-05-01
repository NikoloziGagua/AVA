import type { Db } from "../state/db.js";
import { listMessages } from "../state/messages.js";
import { buildSystemPrompt } from "../orchestrator/system-prompt.js";
import type { LLMProvider, Message as LLMMessage } from "../orchestrator/llm/types.js";

export async function runVoiceTurn(args: {
  db: Db;
  provider: LLMProvider;
  memoryDir: string;
  sessionId: string;
  userText: string;
}): Promise<string> {
  const history: LLMMessage[] = listMessages(args.db, args.sessionId).map((m) => ({
    role: m.role === "user" ? "user" : "assistant",
    content: m.content,
  })) as LLMMessage[];
  history.push({ role: "user", content: args.userText });

  const system = buildSystemPrompt({ memoryDir: args.memoryDir, mode: "conversation" });

  const ac = new AbortController();
  const events = args.provider.stream({
    model: args.provider.defaultOrchestratorModel,
    system,
    messages: history,
    tools: [],
    abort: ac.signal,
    reasoningEffort: "none",
  });

  let text = "";
  for await (const e of events) {
    if (e.kind === "delta") text += e.text;
    if (e.kind === "done") break;
  }
  return text.trim();
}
