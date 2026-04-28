import type Anthropic from "@anthropic-ai/sdk";

export type ParseResult =
  | { ok: true; parsed: object }
  | { ok: false; reason: string };

const SYSTEM = `You parse natural-language autonomy rules into strict JSON.
Schema: { "match": { "tool"?: string, "args.cwd"?: string[], "args.path"?: string[], "args.command"?: string[] }, "action": "allow" | "ask" | "deny" }
- "tool" is one of: shell, fs_read, fs_write, fs_list, fs_stat, fs_delete, claude_code, chrome_navigate, chrome_click, chrome_type, chrome_press_key, chrome_read_page, chrome_screenshot, chrome_tabs, computer_use. Or "*" for any.
- args.* fields are arrays of glob patterns (picomatch syntax). Use forward slashes; "**" matches across path separators.
- "action" must be exactly "allow", "ask", or "deny".
Return ONLY the JSON object — no preamble, no fences, no explanation.`;

const ACTIONS = new Set(["allow", "ask", "deny"]);

function isValid(parsed: unknown): parsed is { match: object; action: string } {
  if (!parsed || typeof parsed !== "object") return false;
  const o = parsed as Record<string, unknown>;
  if (!o.match || typeof o.match !== "object") return false;
  if (typeof o.action !== "string" || !ACTIONS.has(o.action)) return false;
  return true;
}

export async function parseRule({
  client,
  source,
}: {
  client: Anthropic;
  source: string;
}): Promise<ParseResult> {
  try {
    const r = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      system: SYSTEM,
      messages: [{ role: "user", content: source }],
    });
    const block = r.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") return { ok: false, reason: "no text response" };
    const text = block.text.trim();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, reason: "invalid JSON in response" };
    }
    if (!isValid(json)) return { ok: false, reason: "schema mismatch" };
    return { ok: true, parsed: json };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "unknown error" };
  }
}
