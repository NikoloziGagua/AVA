import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import { scrubSecrets } from "../security/scrub.js";

const IdentitySchema = z.object({
  agent: z.object({ name: z.string(), kind: z.string() }),
  room_name: z.string(),
});

const InboxMessageSchema = z.object({
  id: z.number().int().positive(),
  priority: z.string().optional(),
  kind: z.string().optional(),
  body: z.string(),
  created_at: z.union([z.string(), z.number()]).optional(),
  from: z.string(),
  to: z.string().optional(),
  needs_ack: z.boolean().optional(),
});

const SendResultSchema = z.object({
  id: z.number().int().positive().nullable(),
  recipients: z.array(z.string()).max(30),
  note: z.string().optional(),
});

export type AgentroomAvailability = "ready" | "unconfigured" | "unreachable" | "identity_mismatch";

export type AgentroomIdentityStatus = {
  availability: AgentroomAvailability;
  identity: "AVA";
  roomName: string | null;
  reason: string | null;
};

export type AgentroomInboxMessage = {
  id: number;
  from: string;
  to: string;
  priority: "normal" | "urgent";
  kind: "message" | "ask" | "request";
  body: string;
  createdAt: string | null;
  needsAck: boolean;
};

export type AgentroomPostResult = {
  messageId: number;
  recipients: string[];
};

type McpCall = (name: "read_inbox" | "send_message", args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;

export type AgentroomClientOptions = {
  hubUrl: string | null;
  token: string | null;
  fetchImpl?: typeof fetch;
  callMcp?: McpCall;
  timeoutMs?: number;
};

function compact(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return scrubSecrets(value).replace(/\s+/g, " ").trim().slice(0, max);
}

function isoTimestamp(value: string | number | undefined): string | null {
  if (value === undefined) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function textContent(result: unknown): string {
  if (!result || typeof result !== "object") throw new Error("agentroom returned a malformed MCP result");
  const value = result as { isError?: boolean; content?: Array<{ type?: string; text?: string }> };
  const first = value.content?.find((item) => item.type === "text" && typeof item.text === "string")?.text;
  if (!first) throw new Error("agentroom returned no readable result");
  if (value.isError) throw new Error(compact(first, 500) || "agentroom rejected the request");
  return first;
}

/**
 * Narrow agentroom adapter for AVA. It deliberately has no generic `callTool`
 * surface: only read_inbox and send_message are constructible.
 */
export class AgentroomClient {
  private readonly hubUrl: string | null;
  private readonly token: string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly injectedCall: McpCall | null;

  constructor(options: AgentroomClientOptions) {
    this.hubUrl = options.hubUrl?.replace(/\/$/, "") || null;
    this.token = options.token?.trim() || null;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.injectedCall = options.callMcp ?? null;
  }

  get configured(): boolean {
    return Boolean(this.hubUrl && this.token);
  }

  private timeoutSignal(parent?: AbortSignal): { signal: AbortSignal; clear: () => void } {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("agentroom request timed out")), this.timeoutMs);
    timer.unref?.();
    const onAbort = () => controller.abort(parent?.reason);
    parent?.addEventListener("abort", onAbort, { once: true });
    return {
      signal: controller.signal,
      clear: () => {
        clearTimeout(timer);
        parent?.removeEventListener("abort", onAbort);
      },
    };
  }

  async inspect(signal?: AbortSignal): Promise<AgentroomIdentityStatus> {
    if (!this.hubUrl || !this.token) {
      return { availability: "unconfigured", identity: "AVA", roomName: null, reason: "AVA's room credentials are not configured." };
    }
    const bounded = this.timeoutSignal(signal);
    try {
      const response = await this.fetchImpl(`${this.hubUrl}/api/me`, {
        headers: { authorization: `Bearer ${this.token}` },
        signal: bounded.signal,
      });
      if (!response.ok) {
        return { availability: "unreachable", identity: "AVA", roomName: null, reason: `Agentroom rejected AVA's credentials (${response.status}).` };
      }
      const parsed = IdentitySchema.safeParse(await response.json());
      if (!parsed.success) {
        return { availability: "unreachable", identity: "AVA", roomName: null, reason: "Agentroom returned malformed identity evidence." };
      }
      const roomName = compact(parsed.data.room_name, 80) || null;
      if (parsed.data.agent.name !== "AVA" || parsed.data.agent.kind !== "other") {
        return {
          availability: "identity_mismatch",
          identity: "AVA",
          roomName,
          reason: "The configured token is not the discussion-only AVA identity.",
        };
      }
      return { availability: "ready", identity: "AVA", roomName, reason: null };
    } catch (error) {
      return {
        availability: "unreachable",
        identity: "AVA",
        roomName: null,
        reason: compact(error instanceof Error ? error.message : String(error), 300) || "Agentroom is unreachable.",
      };
    } finally {
      bounded.clear();
    }
  }

  private async call(name: "read_inbox" | "send_message", args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (!this.hubUrl || !this.token) throw new Error("AVA's room credentials are not configured");
    if (this.injectedCall) return this.injectedCall(name, args, signal);
    const bounded = this.timeoutSignal(signal);
    const client = new Client({ name: "ava-room-member", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${this.hubUrl}/mcp`), {
      requestInit: {
        headers: { authorization: `Bearer ${this.token}` },
        signal: bounded.signal,
      },
    });
    try {
      await client.connect(transport);
      return await client.callTool({ name, arguments: args });
    } finally {
      bounded.clear();
      await client.close().catch(() => undefined);
    }
  }

  async readInbox(input: { sinceId?: number; limit?: number; unreadOnly?: boolean } = {}, signal?: AbortSignal): Promise<AgentroomInboxMessage[]> {
    const limit = Math.max(1, Math.min(30, Math.trunc(input.limit ?? 20)));
    const raw = await this.call("read_inbox", { include_read: input.unreadOnly === false }, signal);
    let json: unknown;
    try { json = JSON.parse(textContent(raw)); }
    catch (error) {
      if (error instanceof SyntaxError) throw new Error("agentroom returned malformed inbox data");
      throw error;
    }
    if (!Array.isArray(json)) throw new Error("agentroom returned malformed inbox data");
    const messages: AgentroomInboxMessage[] = [];
    for (const candidate of json) {
      const parsed = InboxMessageSchema.safeParse(candidate);
      if (!parsed.success || (input.sinceId !== undefined && parsed.data.id <= input.sinceId)) continue;
      const body = compact(parsed.data.body, 3_000);
      const from = compact(parsed.data.from, 80);
      if (!body || !from) continue;
      messages.push({
        id: parsed.data.id,
        from,
        to: compact(parsed.data.to ?? "AVA", 80) || "AVA",
        priority: parsed.data.priority === "urgent" ? "urgent" : "normal",
        kind: parsed.data.kind === "ask" || parsed.data.kind === "request" ? parsed.data.kind : "message",
        body,
        createdAt: isoTimestamp(parsed.data.created_at),
        needsAck: parsed.data.needs_ack === true,
      });
    }
    return messages.sort((a, b) => a.id - b.id).slice(-limit);
  }

  async sendMessage(body: string, signal?: AbortSignal): Promise<AgentroomPostResult> {
    const raw = await this.call("send_message", { body, priority: "normal" }, signal);
    let json: unknown;
    try { json = JSON.parse(textContent(raw)); }
    catch (error) {
      if (error instanceof SyntaxError) throw new Error("agentroom returned malformed send evidence");
      throw error;
    }
    const parsed = SendResultSchema.safeParse(json);
    if (!parsed.success || parsed.data.id === null) {
      throw new Error(compact(parsed.success ? parsed.data.note : "", 300) || "Agentroom did not record the message.");
    }
    return {
      messageId: parsed.data.id,
      recipients: parsed.data.recipients.map((name) => compact(name, 80)).filter(Boolean),
    };
  }
}
