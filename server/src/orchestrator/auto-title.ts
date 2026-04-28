import type Anthropic from "@anthropic-ai/sdk";

export type AutoTitleArgs = {
  client: Anthropic;
  firstMessage: string;
};

const MAX = 60;

function truncate(s: string): string {
  return s.slice(0, MAX);
}

export async function autoTitle({ client, firstMessage }: AutoTitleArgs): Promise<string> {
  try {
    const r = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 32,
      messages: [
        {
          role: "user",
          content:
            "Title the following user message in 3-7 words. Output the title only, no quotes, no preamble.\n\n" +
            firstMessage,
        },
      ],
    });
    const block = r.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return truncate(firstMessage);
    const title = block.text.trim();
    if (!title) return truncate(firstMessage);
    return title.length > MAX ? truncate(title) : title;
  } catch {
    return truncate(firstMessage);
  }
}
