import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../state/db.js";
import {
  StaleSelfWorkerSelectionError,
  getSelfWorkerSelection,
  setSelfWorkerSelection,
} from "./worker-selection.js";
import { createIntent, getIntent } from "./intents.js";

describe("self worker selection store", () => {
  it("defaults to Claude and snapshots the selection onto an intent", () => {
    const db = openDb(":memory:");
    const selection = getSelfWorkerSelection(db);
    expect(selection).toMatchObject({ provider: "claude", version: 1 });
    const id = createIntent(db, { trigger: "explicit", goal: "test", worker: selection });
    expect(getIntent(db, id)).toMatchObject({ worker_provider: "claude", worker_selection_version: 1 });
  });

  it("uses optimistic concurrency and never changes an existing intent", () => {
    const db = openDb(":memory:");
    const oldId = createIntent(db, { trigger: "explicit", goal: "old" });
    const next = setSelfWorkerSelection(db, "codex", 1);
    expect(next).toMatchObject({ provider: "codex", version: 2 });
    expect(() => setSelfWorkerSelection(db, "claude", 1)).toThrow(StaleSelfWorkerSelectionError);
    expect(getIntent(db, oldId)!.worker_provider).toBe("claude");
    const newId = createIntent(db, { trigger: "explicit", goal: "new" });
    expect(getIntent(db, newId)).toMatchObject({ worker_provider: "codex", worker_selection_version: 2 });
  });

  it("persists the selected provider across a database restart", () => {
    const path = join(mkdtempSync(join(tmpdir(), "ava-worker-setting-")), "state.db");
    const first = openDb(path);
    setSelfWorkerSelection(first, "codex", 1);
    first.close();
    const reopened = openDb(path);
    expect(getSelfWorkerSelection(reopened)).toMatchObject({ provider: "codex", version: 2 });
    reopened.close();
  });
});
