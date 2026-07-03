import { describe, it, expect, vi } from "vitest";
import { openInMemoryDb } from "../state/db.js";
import { createWatch, listWatches, dueWatches, recordWatchRun, getWatch } from "../state/watches.js";
import { parseWatchMarker, buildCheckPrompt, tickOnce, type SchedulerDeps } from "./scheduler.js";

const quiet = { info: () => {}, warn: () => {} };

function deps(db: ReturnType<typeof openInMemoryDb>, over: Partial<SchedulerDeps>): SchedulerDeps {
  return { db, baseUrl: "http://x", token: () => "t", notify: () => {}, log: quiet, ...over };
}

describe("watches state", () => {
  it("creates, lists, and finds due watches", () => {
    const db = openInMemoryDb();
    const w = createWatch(db, { prompt: "check RTX 5090 price < $1800", intervalMinutes: 30 });
    expect(listWatches(db)).toHaveLength(1);
    expect(w.once).toBe(1);
    // never run -> due immediately
    expect(dueWatches(db).map((x) => x.id)).toEqual([w.id]);
    // just ran -> not due
    recordWatchRun(db, w.id, { status: "ok", result: "still $4000" });
    expect(dueWatches(db)).toHaveLength(0);
    // past the interval -> due again
    recordWatchRun(db, w.id, { status: "ok", result: "still $4000", now: Date.now() - 31 * 60_000 });
    expect(dueWatches(db)).toHaveLength(1);
  });
});

describe("marker parsing", () => {
  it("parses TRIGGERED with reason", () => {
    const r = parseWatchMarker("Checked the shops.\nWATCH: TRIGGERED — price fell to $1750 at Newegg");
    expect(r).toEqual({ status: "triggered", detail: "price fell to $1750 at Newegg" });
  });
  it("parses OK", () => {
    expect(parseWatchMarker("WATCH: OK — still ~$4000 everywhere").status).toBe("ok");
  });
  it("missing marker -> unclear with a snippet", () => {
    const r = parseWatchMarker("I looked around but got distracted.");
    expect(r.status).toBe("unclear");
    expect(r.detail).toContain("distracted");
  });
  it("check prompt demands the marker and embeds the watch prompt", () => {
    const db = openInMemoryDb();
    const w = createWatch(db, { prompt: "watch the thing", intervalMinutes: 5 });
    const p = buildCheckPrompt(w);
    expect(p).toContain("watch the thing");
    expect(p).toContain("WATCH: TRIGGERED");
  });
});

describe("tickOnce", () => {
  it("runs due checks, records outcome, notifies + disables one-shot on trigger", async () => {
    const db = openInMemoryDb();
    const w = createWatch(db, { prompt: "price check", intervalMinutes: 15 });
    const notify = vi.fn();
    await tickOnce(deps(db, {
      notify,
      runCheck: async () => ({ kind: "final", text: "found it\nWATCH: TRIGGERED — dropped to $1700", sessionId: "s1" }),
    }));
    const after = getWatch(db, w.id)!;
    expect(after.last_status).toBe("triggered");
    expect(after.enabled).toBe(0); // once=1 -> disabled after trigger
    expect(after.session_id).toBe("s1");
    expect(notify).toHaveBeenCalledOnce();
    expect(notify.mock.calls[0]![0]).toContain("$1700");
  });

  it("keeps repeating watches enabled and records ok runs silently", async () => {
    const db = openInMemoryDb();
    const w = createWatch(db, { prompt: "news check", intervalMinutes: 15, once: false });
    const notify = vi.fn();
    await tickOnce(deps(db, {
      notify,
      runCheck: async () => ({ kind: "final", text: "WATCH: OK — nothing new", sessionId: "s2" }),
    }));
    const after = getWatch(db, w.id)!;
    expect(after.enabled).toBe(1);
    expect(after.last_status).toBe("ok");
    expect(notify).not.toHaveBeenCalled();
  });

  it("records errors without crashing the tick", async () => {
    const db = openInMemoryDb();
    const w = createWatch(db, { prompt: "x", intervalMinutes: 15 });
    await tickOnce(deps(db, {
      runCheck: async () => ({ kind: "error", message: "POST /api/chat 503" }),
    }));
    expect(getWatch(db, w.id)!.last_status).toBe("error");
  });
});
