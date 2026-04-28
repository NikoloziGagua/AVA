import type { LLMProvider } from "./llm/types.js";

export type AutoTitleArgs = {
  provider: LLMProvider;
  firstMessage: string;
};

const MAX = 60;

const SYSTEM =
  "You produce short session titles. Output ONLY a 3-7 word phrase summarizing the user's message. No quotes. No trailing punctuation.";

function truncate(s: string): string {
  return s.slice(0, MAX);
}

function stripQuotes(s: string): string {
  if (s.length >= 2) {
    const first = s.charAt(0);
    const last = s.charAt(s.length - 1);
    if ((first === '"' || first === "'") && first === last) {
      return s.slice(1, -1);
    }
  }
  return s;
}

export async function autoTitle({ provider, firstMessage }: AutoTitleArgs): Promise<string> {
  try {
    const raw = await provider.complete({
      model: provider.defaultSideModel,
      system: SYSTEM,
      user: firstMessage,
      maxTokens: 32,
    });
    const title = stripQuotes(raw.trim()).trim();
    if (!title) return truncate(firstMessage);
    return title.length > MAX ? truncate(title) : title;
  } catch {
    return truncate(firstMessage);
  }
}
