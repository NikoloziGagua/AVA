import { describe, it, expect } from "vitest";
import { openDb } from "../state/db.js";
import { createDiscussion, getDiscussion } from "../state/discussions.js";
import { runDiscussion, type DiscussDeps } from "./discuss.js";

function db() { return openDb(":memory:"); }

type Delivered = { sessionId: string | null; topic: string; ok: boolean; result: string };

function deps(over: Partial<DiscussDeps> = {}): { deps: DiscussDeps; delivered: Delivered[] } {
  const delivered: Delivered[] = [];
  return {
    delivered,
    deps: {
      consult: async () => ({ ok: true, text: "Claude's take" }),
      deliver: (o) => { delivered.push(o); },
      ...over,
    },
  };
}

describe("runDiscussion", () => {
  it("success: stores the result, marks done, and delivers", async () => {
    const d = db();
    const id = createDiscussion(d, { topic: "cache X?", sessionId: "sess-1" });
    const { deps: dp, delivered } = deps({ consult: async () => ({ ok: true, text: "yes, cache it" }) });

    await runDiscussion(d, id, dp);

    const row = getDiscussion(d, id)!;
    expect(row.status).toBe("done");
    expect(row.result).toBe("yes, cache it");
    expect(row.error).toBeNull();
    expect(delivered).toEqual([
      { sessionId: "sess-1", topic: "cache X?", ok: true, result: "yes, cache it" },
    ]);
  });

  it("failure: stores the error, marks failed, and still delivers", async () => {
    const d = db();
    const id = createDiscussion(d, { topic: "t", sessionId: null });
    const { deps: dp, delivered } = deps({ consult: async () => ({ ok: false, text: "consult failed" }) });

    await runDiscussion(d, id, dp);

    const row = getDiscussion(d, id)!;
    expect(row.status).toBe("failed");
    expect(row.error).toBe("consult failed");
    expect(delivered).toEqual([
      { sessionId: null, topic: "t", ok: false, result: "consult failed" },
    ]);
  });

  it("consult throwing: marks failed and still delivers", async () => {
    const d = db();
    const id = createDiscussion(d, { topic: "t", sessionId: "s" });
    const { deps: dp, delivered } = deps({ consult: async () => { throw new Error("kaboom"); } });

    await runDiscussion(d, id, dp);

    const row = getDiscussion(d, id)!;
    expect(row.status).toBe("failed");
    expect(row.error).toMatch(/kaboom/);
    expect(delivered.length).toBe(1);
    expect(delivered[0]!.ok).toBe(false);
  });

  it("missing discussion: does nothing, does not throw", async () => {
    const d = db();
    const { deps: dp, delivered } = deps();
    await expect(runDiscussion(d, "nope", dp)).resolves.toBeUndefined();
    expect(delivered.length).toBe(0);
  });
});
