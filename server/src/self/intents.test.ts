import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../state/db.js";
import { createIntent, getIntent, listIntents, updateIntent, failStaleIntents } from "./intents.js";

function db() { return openDb(join(mkdtempSync(join(tmpdir(), "ava-self-")), "x.db")); }

describe("self_improvements store", () => {
  it("creates a queued intent and reads it back", () => {
    const d = db();
    const id = createIntent(d, { trigger: "explicit", goal: "be faster at X" });
    const row = getIntent(d, id)!;
    expect(row.goal).toBe("be faster at X");
    expect(row.status).toBe("queued");
    expect(row.trigger).toBe("explicit");
  });

  it("updates status + fields and lists newest first", () => {
    const d = db();
    const a = createIntent(d, { trigger: "explicit", goal: "a" });
    const b = createIntent(d, { trigger: "explicit", goal: "b" });
    updateIntent(d, b, { status: "swapped", commit_sha: "deadbeef", diff_summary: "did b" });
    expect(getIntent(d, b)!.status).toBe("swapped");
    expect(getIntent(d, b)!.commit_sha).toBe("deadbeef");
    expect(listIntents(d).map((r) => r.id)).toEqual([b, a]);
  });

  it("failStaleIntents reconciles orphaned non-terminal intents, leaving terminal ones", () => {
    const d = db();
    const queued = createIntent(d, { trigger: "explicit", goal: "queued" });
    const implementing = createIntent(d, { trigger: "explicit", goal: "impl" });
    updateIntent(d, implementing, { status: "implementing" });
    const shipped = createIntent(d, { trigger: "explicit", goal: "done" });
    updateIntent(d, shipped, { status: "swapped" });

    const n = failStaleIntents(d);
    expect(n).toBe(2);
    expect(getIntent(d, queued)!.status).toBe("failed");
    expect(getIntent(d, implementing)!.status).toBe("failed");
    expect(getIntent(d, implementing)!.error).toMatch(/restart/i);
    expect(getIntent(d, shipped)!.status).toBe("swapped"); // terminal untouched

    expect(failStaleIntents(d)).toBe(0); // idempotent — nothing left to reconcile
  });
});
