import { describe, it, expect, vi } from "vitest";
import { buildDiscussTools } from "./discuss-mcp.js";
import type { Discussion } from "../state/discussions.js";

const ctx = { runId: "r" };

function disc(over: Partial<Discussion> = {}): Discussion {
  return {
    id: "d1", created_at: 1, topic: "t", status: "running",
    result: null, error: null, session_id: "sess-1", ...over,
  };
}

describe("buildDiscussTools", () => {
  it("discuss_with_claude queues with the bound session and returns immediately", async () => {
    const queue = vi.fn(() => "d1");
    const tools = buildDiscussTools({ queue, list: () => [], get: () => null, sessionId: "sess-1" });
    const discuss = tools.find((t) => t.tool.name === "discuss_with_claude")!;

    const r = await discuss.run({ topic: "should we cache X" }, ctx);

    expect(queue).toHaveBeenCalledWith("should we cache X", "sess-1");
    expect(r.ok).toBe(true);
    expect(r.text).toContain("Started conferring with Claude");
    expect(r.text).toContain("should we cache X");
    // Non-blocking: it never awaits the consult — only the queue (sync) is called.
    expect(queue).toHaveBeenCalledTimes(1);
  });

  it("discuss_with_claude rejects an empty topic", async () => {
    const queue = vi.fn(() => "d1");
    const tools = buildDiscussTools({ queue, list: () => [], get: () => null, sessionId: null });
    const discuss = tools.find((t) => t.tool.name === "discuss_with_claude")!;
    const r = await discuss.run({ topic: "   " }, ctx);
    expect(r.ok).toBe(false);
    expect(queue).not.toHaveBeenCalled();
  });

  it("read_discussion with id returns the finished result", async () => {
    const done = disc({ id: "dX", topic: "caching", status: "done", result: "yes, cache it" });
    const tools = buildDiscussTools({ queue: () => "", list: () => [done], get: (id) => (id === "dX" ? done : null), sessionId: null });
    const read = tools.find((t) => t.tool.name === "read_discussion")!;

    const r = await read.run({ id: "dX" }, ctx);
    expect(r.text).toContain("caching");
    expect(r.text).toContain("yes, cache it");

    const miss = await read.run({ id: "nope" }, ctx);
    expect(miss.text).toContain("No discussion nope");
  });

  it("read_discussion without id lists recent and shows the latest done result", async () => {
    const running = disc({ id: "d2", topic: "later", status: "running" });
    const done = disc({ id: "d1", topic: "earlier", status: "done", result: "the answer" });
    const tools = buildDiscussTools({ queue: () => "", list: () => [running, done], get: () => null, sessionId: null });
    const read = tools.find((t) => t.tool.name === "read_discussion")!;

    const r = await read.run({}, ctx);
    expect(r.text).toContain("d2");
    expect(r.text).toContain("in progress");
    expect(r.text).toContain("the answer"); // latest done result surfaced
  });

  it("read_discussion with no discussions yet is friendly", async () => {
    const tools = buildDiscussTools({ queue: () => "", list: () => [], get: () => null, sessionId: null });
    const read = tools.find((t) => t.tool.name === "read_discussion")!;
    const r = await read.run({}, ctx);
    expect(r.text).toMatch(/haven't discussed anything yet/i);
  });
});
