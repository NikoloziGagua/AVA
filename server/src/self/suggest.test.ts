import { describe, it, expect, vi } from "vitest";
import { suggestImprovement } from "./suggest.js";

const worker = (output: string, ok = true) => ({
  run: vi.fn(async () => (ok ? { ok: true as const, output, exitCode: 0 } : { ok: false as const, reason: "x" })),
});
const session = { id: "s", resume: true };

describe("suggestImprovement", () => {
  it("parses the GOAL line and consults the persistent session in the given cwd", async () => {
    const w = worker("Looking at the code...\nGOAL: add a /api/version endpoint returning the package version\n");
    const goal = await suggestImprovement(w, { cwd: "/repo", session });
    expect(goal).toBe("add a /api/version endpoint returning the package version");
    expect(w.run).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/repo", session }));
  });

  it("returns null for 'GOAL: none'", async () => {
    expect(await suggestImprovement(worker("GOAL: none"), { cwd: "/r", session })).toBeNull();
  });

  it("returns null when the worker fails or there is no GOAL line", async () => {
    expect(await suggestImprovement(worker("", false), { cwd: "/r", session })).toBeNull();
    expect(await suggestImprovement(worker("just rambling, no goal"), { cwd: "/r", session })).toBeNull();
  });
});
