import { describe, expect, it, vi } from "vitest";
import { AgentroomClient } from "./client.js";

const result = (value: unknown) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

describe("AgentroomClient", () => {
  it("reports unconfigured without touching the network", async () => {
    const fetchImpl = vi.fn();
    const client = new AgentroomClient({ hubUrl: null, token: null, fetchImpl });
    await expect(client.inspect()).resolves.toMatchObject({ availability: "unconfigured", identity: "AVA" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("requires the exact AVA/other identity", async () => {
    const wrong = new AgentroomClient({
      hubUrl: "https://room.test", token: "secret",
      fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({ agent: { name: "Nika-codex", kind: "codex" }, room_name: "dev" }), { status: 200 })),
    });
    await expect(wrong.inspect()).resolves.toMatchObject({ availability: "identity_mismatch", roomName: "dev" });
    const ready = new AgentroomClient({
      hubUrl: "https://room.test", token: "secret",
      fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({ agent: { name: "AVA", kind: "other" }, room_name: "dev" }), { status: 200 })),
    });
    await expect(ready.inspect()).resolves.toEqual({ availability: "ready", identity: "AVA", roomName: "dev", reason: null });
  });

  it("constructs only read_inbox and send_message calls", async () => {
    const callMcp = vi.fn()
      .mockResolvedValueOnce(result([
        { id: 2, from: "Claude", to: "AVA", body: "token=unsafe-value Please review", kind: "request", priority: "urgent", created_at: "2026-09-24T00:00:00Z" },
        { id: 4, from: "Codex", to: "AVA", body: "A useful reply", kind: "message", priority: "normal" },
      ]))
      .mockResolvedValueOnce(result({ id: 9, recipients: ["Claude", "Codex"] }));
    const client = new AgentroomClient({ hubUrl: "https://room.test", token: "secret", callMcp });
    const inbox = await client.readInbox({ sinceId: 2, limit: 1, unreadOnly: false });
    expect(inbox).toEqual([expect.objectContaining({ id: 4, body: "A useful reply" })]);
    expect(await client.sendMessage("hello")).toEqual({ messageId: 9, recipients: ["Claude", "Codex"] });
    expect(callMcp.mock.calls.map((call) => call[0])).toEqual(["read_inbox", "send_message"]);
    expect(JSON.stringify(inbox)).not.toContain("unsafe-value");
  });

  it("fails honestly on MCP errors and malformed evidence", async () => {
    const rejected = new AgentroomClient({
      hubUrl: "https://room.test", token: "secret",
      callMcp: vi.fn().mockResolvedValue({ isError: true, content: [{ type: "text", text: "denied token=unsafe-value" }] }),
    });
    await expect(rejected.sendMessage("hello")).rejects.toThrow(/denied/);

    const malformed = new AgentroomClient({
      hubUrl: "https://room.test", token: "secret",
      callMcp: vi.fn().mockResolvedValue(result({ id: null, recipients: [], note: "Nobody is present" })),
    });
    await expect(malformed.sendMessage("hello")).rejects.toThrow(/Nobody is present/);
  });
});
