import { describe, expect, it, vi } from "vitest";
import { openInMemoryDb } from "../state/db.js";
import { MemoryArchive } from "./archive.js";
import type { ExtractionModel } from "./extractor.js";
import { startMemoryExtraction } from "./scheduler.js";

const MIN = 60_000;

describe("memory extraction scheduler", () => {
  it("waits for a conversation to go quiet, then reads it once; backs off after a failure", async () => {
    const db = openInMemoryDb();
    let now = Date.parse("2026-09-30T10:00:00Z");
    db.prepare("INSERT INTO sessions (id, title, created_at, updated_at, origin) VALUES ('s1', 'chat', ?, ?, 'human')").run(now, now);
    const say = (id: number, text: string, at: number) => db.prepare(
      "INSERT INTO messages (id, session_id, role, content, metadata, created_at) VALUES (?, 's1', 'user', ?, '{}', ?)",
    ).run(id, text, at);
    say(1, "I train jiu-jitsu on Tuesdays", now);
    let fail = true;
    const run = vi.fn(async () => {
      if (fail) throw new Error("upstream unavailable");
      return JSON.stringify({ operations: [{ op: "add", target_id: null, kind: "fact", topic: "training", text: "Niko trains jiu-jitsu on Tuesdays.",
        speech_act: "stated", sensitive: false, confidence: "high", source_message_ids: [1], evidence: "I train jiu-jitsu on Tuesdays", due: null, reason: "routine" }] });
    });
    const model: ExtractionModel = { name: "fake", run };
    const archive = new MemoryArchive(db, () => now);
    const scheduler = startMemoryExtraction({ db, archive, model, now: () => now, intervalMs: 3_600_000 });
    try {
      await scheduler.tick();
      expect(run).not.toHaveBeenCalled(); // still talking
      now += 6 * MIN;
      await scheduler.tick();
      expect(run).toHaveBeenCalledTimes(1); // failed
      fail = false;
      now += 2 * MIN;
      await scheduler.tick();
      expect(run).toHaveBeenCalledTimes(1); // backing off
      now += 10 * MIN;
      await scheduler.tick();
      expect(run).toHaveBeenCalledTimes(2);
      expect(archive.current().map((record) => record.text)).toEqual(["Niko trains jiu-jitsu on Tuesdays."]);
      await scheduler.tick();
      expect(run).toHaveBeenCalledTimes(2); // nothing new
    } finally {
      scheduler.stop();
    }
  });
});
