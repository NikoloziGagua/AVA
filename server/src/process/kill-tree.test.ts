import { describe, it, expect, vi } from "vitest";
import { killTree } from "./kill-tree.js";

vi.mock("tree-kill", () => ({
  default: (pid: number, sig: string, cb: (e?: Error) => void) => {
    if (pid === 1) cb(new Error("ESRCH"));
    else cb();
  },
}));

describe("killTree", () => {
  it("resolves true on successful kill", async () => {
    expect(await killTree(12345)).toBe(true);
  });

  it("resolves false when tree-kill returns ESRCH (already gone)", async () => {
    expect(await killTree(1)).toBe(false);
  });
});
