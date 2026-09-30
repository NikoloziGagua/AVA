import { describe, expect, it, vi } from "vitest";
import { buildAgentroomTools } from "./agentroom-mcp.js";
import type { AgentroomService } from "../agentroom/service.js";

function service(overrides: Partial<AgentroomService> = {}): AgentroomService {
  return {
    toolsEnabled: () => true,
    read: vi.fn().mockResolvedValue([{ id: 5, from: "Claude", to: "AVA", body: "Review done", priority: "normal", kind: "message", createdAt: null, needsAck: false }]),
    post: vi.fn().mockResolvedValue({ schemaVersion: 1, messageId: 8, roomName: "klevar", correlationId: "run_1", postedAt: 100 }),
    ...overrides,
  } as unknown as AgentroomService;
}

describe("buildAgentroomTools", () => {
  it("exposes nothing while disabled", () => {
    expect(buildAgentroomTools({ service: service({ toolsEnabled: () => false }), sessionId: "s1" })).toEqual([]);
  });

  it("exposes only read and post with bounded input", async () => {
    const deps = service();
    const tools = buildAgentroomTools({ service: deps, sessionId: "s1" });
    expect(tools.map((tool) => tool.tool.name)).toEqual(["room_read", "room_post"]);
    expect(await tools[0]!.run({ sinceId: 4, limit: 3 }, { runId: "run_1" })).toMatchObject({ ok: true, text: expect.stringContaining("#5 from Claude") });
    expect(deps.read).toHaveBeenCalledWith({ sinceId: 4, limit: 3, unreadOnly: false }, undefined);
    await expect(tools[0]!.run({ limit: 31 }, { runId: "run_1" })).resolves.toMatchObject({ ok: false });
  });

  it("returns a receipt only after post success and preserves run/session provenance", async () => {
    const deps = service();
    const post = buildAgentroomTools({ service: deps, sessionId: "session_1" })[1]!;
    const result = await post.run({ body: "Here is the proposal", replyTo: 3 }, { runId: "run_1" });
    expect(deps.post).toHaveBeenCalledWith({ body: "Here is the proposal", replyTo: 3, sessionId: "session_1", runId: "run_1" }, undefined);
    expect(result).toMatchObject({ ok: true, roomPost: { messageId: 8 } });

    const failed = service({ post: vi.fn().mockRejectedValue(new Error("offline")) });
    const failure = await buildAgentroomTools({ service: failed, sessionId: "s" })[1]!.run({ body: "x" }, { runId: "r" });
    expect(failure).toEqual({ ok: false, text: "offline" });
    expect(failure).not.toHaveProperty("roomPost");
  });
});
