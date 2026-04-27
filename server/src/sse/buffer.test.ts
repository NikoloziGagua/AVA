import { describe, it, expect, beforeEach } from "vitest";
import { SseBuffer } from "./buffer.js";

describe("SseBuffer", () => {
  let buf: SseBuffer;
  beforeEach(() => {
    buf = new SseBuffer({ maxEvents: 5, maxBytes: 1000 });
  });

  it("assigns monotonically increasing ids starting at 1", () => {
    expect(buf.append({ kind: "text", payload: { text: "a" } })).toBe(1);
    expect(buf.append({ kind: "text", payload: { text: "b" } })).toBe(2);
  });

  it("retrieves events after a given id", () => {
    buf.append({ kind: "text", payload: { text: "a" } });
    const id2 = buf.append({ kind: "text", payload: { text: "b" } });
    const id3 = buf.append({ kind: "text", payload: { text: "c" } });
    const out = buf.since(1);
    expect(out.gap).toBe(false);
    expect(out.events.map((e) => e.id)).toEqual([id2, id3]);
  });

  it("evicts oldest when count exceeds maxEvents and reports gap on stale id", () => {
    for (let i = 0; i < 10; i++) buf.append({ kind: "text", payload: { text: String(i) } });
    const out = buf.since(0);
    expect(out.gap).toBe(true);
    expect(out.events).toHaveLength(5);
    expect(out.oldestBuffered).toBe(6);
  });

  it("returns empty + no gap when caller is up to date", () => {
    const id1 = buf.append({ kind: "text", payload: { text: "a" } });
    const out = buf.since(id1);
    expect(out.gap).toBe(false);
    expect(out.events).toHaveLength(0);
  });

  it("evicts when total bytes exceed maxBytes", () => {
    const small = new SseBuffer({ maxEvents: 1000, maxBytes: 500 });
    const huge = "x".repeat(200);
    small.append({ kind: "text", payload: { text: huge } });
    small.append({ kind: "text", payload: { text: huge } });
    small.append({ kind: "text", payload: { text: huge } });
    expect(small.size()).toBeLessThan(3);
  });
});
