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

describe("reminders and schedules (watches v2)", () => {
  it("run_at one-shot: not due before, due after, disabled after firing", async () => {
    const db = openInMemoryDb();
    const at = Date.now() + 10 * 60_000;
    const w = createWatch(db, { prompt: "Call Mom", kind: "reminder", runAt: at });
    expect(dueWatches(db, at - 60_000)).toHaveLength(0);
    expect(dueWatches(db, at + 1000).map((x) => x.id)).toEqual([w.id]);

    const notify = vi.fn();
    vi.useFakeTimers({ now: at + 1000 });
    try {
      await tickOnce(deps(db, { notify }));
    } finally { vi.useRealTimers(); }
    expect(notify).toHaveBeenCalledOnce();
    expect(notify.mock.calls[0]![0]).toContain("Call Mom");
    const after = getWatch(db, w.id)!;
    expect(after.enabled).toBe(0);
    expect(after.last_status).toBe("triggered");
  });

  it("reminders never invoke the agent runner", async () => {
    const db = openInMemoryDb();
    createWatch(db, { prompt: "stretch!", kind: "reminder", runAt: Date.now() - 1000 });
    const runCheck = vi.fn();
    await tickOnce(deps(db, { runCheck }));
    expect(runCheck).not.toHaveBeenCalled();
  });

  it("daily_at: due after today's occurrence, once per day, stays enabled", async () => {
    const db = openInMemoryDb();
    const w = createWatch(db, { prompt: "morning briefing", dailyAt: "08:30", once: true });
    const today0829 = new Date(); today0829.setHours(8, 29, 0, 0);
    const today0831 = new Date(); today0831.setHours(8, 31, 0, 0);
    expect(dueWatches(db, today0829.getTime())).toHaveLength(0);
    expect(dueWatches(db, today0831.getTime())).toHaveLength(1);
    // ran at 08:31 -> not due again the same day, due again tomorrow
    recordWatchRun(db, w.id, { status: "triggered", result: "sent", now: today0831.getTime() });
    const today0900 = new Date(); today0900.setHours(9, 0, 0, 0);
    expect(dueWatches(db, today0900.getTime())).toHaveLength(0);
    const tomorrow0831 = new Date(today0831.getTime() + 24 * 3600_000);
    expect(dueWatches(db, tomorrow0831.getTime())).toHaveLength(1);
    // daily watches are exempt from once-disabling
    expect(getWatch(db, w.id)!.enabled).toBe(1);
  });

  it("a failing one-shot check does not retry forever", async () => {
    const db = openInMemoryDb();
    const w = createWatch(db, { prompt: "check thing once", runAt: Date.now() - 1000 });
    await tickOnce(deps(db, {
      runCheck: async () => ({ kind: "error", message: "boom" }),
    }));
    expect(getWatch(db, w.id)!.enabled).toBe(0);
  });

  it("rejects malformed daily_at", () => {
    const db = openInMemoryDb();
    expect(() => createWatch(db, { prompt: "x", dailyAt: "25:99" })).toThrow(/invalid dailyAt/);
  });
});
