import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../state/db.js";
import { createIntent, getIntent } from "./intents.js";
import { runImprovement, type ImproverDeps } from "./improver.js";

function db() {
  return openDb(join(mkdtempSync(join(tmpdir(), "ava-queue-")), "x.db"));
}

// Fully faked deps — the queue/single-flight behaviour is what's under test, not
// the real worktree/verify/swap machinery (covered by improver.integration.test).
function fakeDeps(over: Partial<ImproverDeps> = {}): ImproverDeps {
  return {
    reflect: async () => "CHANGE: do it",
    addWorktree: (id) => ({ path: join(tmpdir(), "wt-" + id), branch: "wt-" + id }),
    removeWorktree: () => {},
    implement: async () => ({ ok: true, output: "done" }),
    verify: async () => ({ ok: true, log: "ok" }),
    headSha: () => "goodsha",
    commitWorktree: () => "newsha",
    swapTo: () => {},
    revertTo: () => {},
    restart: async () => {},
    watch: async () => {},
    emit: () => {},
    ...over,
  };
}

async function waitFor(cond: () => boolean, ms = 1500): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("improver queue (concurrent intents wait their turn, never fail)", () => {
  it("queues a second intent while one is in flight, then runs it after", async () => {
    const d = db();
    const a = createIntent(d, { trigger: "explicit", goal: "first" });
    const b = createIntent(d, { trigger: "explicit", goal: "second" });

    let reflectCalls = 0;
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((res) => { releaseFirst = res; });
    const deps = fakeDeps({
      reflect: async () => {
        reflectCalls += 1;
        if (reflectCalls === 1) await firstGate; // park the first run mid-flight
        return "CHANGE: do it";
      },
    });

    const pA = runImprovement(d, a, deps);
    await waitFor(() => getIntent(d, a)!.status === "reflecting"); // A holds the slot

    // B arrives while A is in flight. The OLD behaviour marked B "failed"
    // ("another improvement is in progress"); it must now wait as "queued".
    await runImprovement(d, b, deps);
    expect(getIntent(d, b)!.status).toBe("queued");

    releaseFirst();
    await pA;
    await waitFor(() => getIntent(d, b)!.status === "swapped");

    expect(getIntent(d, a)!.status).toBe("swapped");
    expect(getIntent(d, b)!.status).toBe("swapped");
  });
});
