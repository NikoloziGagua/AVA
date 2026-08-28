import { describe, expect, it } from "vitest";
import { openInMemoryDb } from "../state/db.js";
import { createWatch, getWatch, recordCodexCompleted, recordCodexSuccessor } from "../state/watches.js";
import { buildWatchTools } from "./watches-mcp.js";

describe("watch_create tool", () => {
  it("keeps ordinary AVA monitors on the shared scheduler path", async () => {
    const db = openInMemoryDb();
    const create = buildWatchTools({ db }).find((entry) => entry.tool.name === "watch_create")!;
    const result = await create.run({ prompt: "check Instagram inbox", interval_minutes: 15, once: false });

    expect(result.ok).toBe(true);
    const watch = db.prepare("SELECT * FROM watches").get() as { kind: string; target_thread_id: string | null };
    expect(watch).toMatchObject({ kind: "check", target_thread_id: null });
  });

  it("pins Codex target identity and cycle ancestry", async () => {
    const db = openInMemoryDb();
    const target = { threadId: "thread-exact", sessionFile: "C:/sessions/exact.jsonl", cwd: "C:/repo/AVA" };
    const create = buildWatchTools({ db, resolveCodexTarget: () => target })
      .find((entry) => entry.tool.name === "watch_create")!;
    const result = await create.run({
      prompt: "build notes",
      kind: "codex",
      interval_minutes: 1,
      continue_cycle: true,
      parent_watch_id: "previous-watch",
    });

    expect(result).toMatchObject({ ok: true });
    const id = /\(([A-Za-z0-9_-]+)\)/.exec(result.text)?.[1];
    expect(getWatch(db, id!)).toMatchObject({
      kind: "codex",
      target_thread_id: "thread-exact",
      target_session_file: "C:/sessions/exact.jsonl",
      target_cwd: "C:/repo/AVA",
      continue_cycle: 1,
      parent_watch_id: "previous-watch",
    });
  });

  it("refuses an unpinned Codex watch", async () => {
    const db = openInMemoryDb();
    const create = buildWatchTools({ db }).find((entry) => entry.tool.name === "watch_create")!;
    const result = await create.run({ prompt: "build notes", kind: "codex", interval_minutes: 1 });
    expect(result).toMatchObject({ ok: false });
    expect(result.text).toContain("no active Codex TUI thread");
  });

  it("normalizes an empty root-cycle parent to NULL", async () => {
    const db = openInMemoryDb();
    const target = { threadId: "thread-root", sessionFile: "C:/sessions/root.jsonl", cwd: "C:/repo/AVA" };
    const create = buildWatchTools({ db, resolveCodexTarget: () => target })
      .find((entry) => entry.tool.name === "watch_create")!;
    await create.run({
      prompt: "first cycle task",
      kind: "codex",
      interval_minutes: 1,
      parent_watch_id: "   ",
    });
    const watch = db.prepare("SELECT parent_watch_id FROM watches").get() as { parent_watch_id: string | null };
    expect(watch.parent_watch_id).toBeNull();
  });

  it("lists completed task state separately from blocked successor planning", async () => {
    const db = openInMemoryDb();
    const created = createWatch(db, {
      prompt: "completed task",
      kind: "codex",
      intervalMinutes: 1,
      target: { threadId: "thread-list", sessionFile: "C:/sessions/list.jsonl", cwd: "C:/repo/AVA" },
      continueCycle: true,
    });
    recordCodexCompleted(db, created.id, 10);
    recordCodexSuccessor(db, created.id, {
      status: "blocked",
      result: "AVA provider quota exhausted",
      now: 11,
    });
    const list = buildWatchTools({ db }).find((entry) => entry.tool.name === "watch_list")!;
    const result = await list.run({});
    expect(result.text).toContain("last: completed");
    expect(result.text).toContain("next: blocked (AVA provider quota exhausted)");
  });
});
