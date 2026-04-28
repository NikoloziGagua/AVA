import { describe, it, expect, vi } from "vitest";
import { withTimeout } from "./timeout.js";

describe("withTimeout", () => {
  it("resolves to the inner value when the promise settles in time", async () => {
    await expect(withTimeout(Promise.resolve(42), 100, "x")).resolves.toBe(42);
  });

  it("rejects with the tagged timeout message after ms when the promise never settles", async () => {
    vi.useFakeTimers();
    try {
      const never = new Promise<number>(() => {});
      const wrapped = withTimeout(never, 50, "tagName");
      const assertion = expect(wrapped).rejects.toThrow("timeout: tagName 50ms");
      await vi.advanceTimersByTimeAsync(50);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not double-resolve if the inner promise settles after the timeout", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
    process.on("unhandledRejection", onUnhandled);
    try {
      let resolveLate: (v: number) => void = () => {};
      const late = new Promise<number>((res) => { resolveLate = res; });
      const wrapped = withTimeout(late, 10, "late");
      await expect(wrapped).rejects.toThrow("timeout: late 10ms");
      // Now settle the inner promise after the timeout already fired.
      resolveLate(99);
      // Give the microtask queue a chance to surface any unhandled rejection.
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
