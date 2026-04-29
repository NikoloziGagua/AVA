import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openInMemoryDb } from "../state/db.js";
import { generateChips } from "./chip-generator.js";
import { createSession } from "../state/sessions.js";
import { appendMessage } from "../state/messages.js";
import { createChip } from "../state/chip-overrides.js";
import { setCachedLabel, hashPrompt } from "../state/chip-label-cache.js";

function setup(): { db: ReturnType<typeof openInMemoryDb>; memDir: string; deviceId: string } {
  const db = openInMemoryDb();
  const deviceId = "d1";
  db.prepare(
    "INSERT INTO device_tokens (id, token_hash, label, created_at) VALUES (?, ?, ?, ?)",
  ).run(deviceId, "h", "test", Date.now());
  const memDir = mkdtempSync(join(tmpdir(), "ava-chipgen-"));
  return { db, memDir, deviceId };
}

const NOW = new Date("2026-04-29T15:00:00").getTime();
const YESTERDAY_NOON = new Date("2026-04-28T12:00:00").getTime();

describe("generateChips", () => {
  it("returns empty when there is nothing to suggest", () => {
    const { db, memDir, deviceId } = setup();
    const r = generateChips({ db, deviceId, memoryDir: memDir, now: NOW });
    expect(r).toEqual([]);
  });

  it("includes pinned chips first", () => {
    const { db, memDir, deviceId } = setup();
    const c = createChip(db, deviceId, { label: "Build", prompt: "build server" });
    const r = generateChips({ db, deviceId, memoryDir: memDir, now: NOW });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: c.id, source: "pinned", label: "Build" });
  });

  it("adds Resume yesterday when a prior-day message exists", () => {
    const { db, memDir, deviceId } = setup();
    const s = createSession(db, { title: "yesterday" });
    db.prepare(
      "INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)",
    ).run(s.id, "user", "hi yesterday", YESTERDAY_NOON);
    const r = generateChips({ db, deviceId, memoryDir: memDir, now: NOW });
    expect(r.some((c) => c.label === "Resume yesterday")).toBe(true);
  });

  it("adds Open <slug> when a recent message references a project", () => {
    const { db, memDir, deviceId } = setup();
    writeFileSync(join(memDir, "MEMORY.md"), "- [yov](projects/yov.md)\n", "utf8");
    mkdirSync(join(memDir, "projects"), { recursive: true });
    writeFileSync(join(memDir, "projects", "yov.md"), "C:/ai/yov\n", "utf8");
    const s = createSession(db, { title: null });
    db.prepare(
      "INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)",
    ).run(s.id, "user", "open C:/ai/yov", NOW - 3600_000);
    const r = generateChips({ db, deviceId, memoryDir: memDir, now: NOW });
    expect(r.some((c) => c.label === "Open yov")).toBe(true);
  });

  it("caps total chips at 5, pinned always wins", () => {
    const { db, memDir, deviceId } = setup();
    for (let i = 0; i < 6; i++) {
      createChip(db, deviceId, { label: `P${i}`, prompt: `p${i}`, position: i });
    }
    const r = generateChips({ db, deviceId, memoryDir: memDir, now: NOW });
    expect(r).toHaveLength(5);
    expect(r.every((c) => c.source === "pinned")).toBe(true);
  });

  it("includes recurring user-message starts when they repeat", () => {
    const { db, memDir, deviceId } = setup();
    const s = createSession(db, { title: null });
    db.prepare(
      "INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)",
    ).run(s.id, "user", "morning standup", NOW - 24 * 3600_000);
    db.prepare(
      "INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)",
    ).run(s.id, "user", "morning standup", NOW - 12 * 3600_000);
    const r = generateChips({ db, deviceId, memoryDir: memDir, now: NOW });
    expect(r.some((c) => c.label.toLowerCase() === "morning standup")).toBe(true);
  });

  it("does not duplicate labels between pinned and auto", () => {
    const { db, memDir, deviceId } = setup();
    createChip(db, deviceId, { label: "Resume yesterday", prompt: "..." });
    const s = createSession(db, { title: null });
    db.prepare(
      "INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)",
    ).run(s.id, "user", "hi yesterday", YESTERDAY_NOON);
    const r = generateChips({ db, deviceId, memoryDir: memDir, now: NOW });
    const labels = r.map((c) => c.label.toLowerCase());
    expect(labels.filter((l) => l === "resume yesterday")).toHaveLength(1);
  });

  it("substitutes cached LLM labels for matching prompt hashes on auto chips", () => {
    const { db, memDir, deviceId } = setup();
    // Simulate two prior user messages so the heuristic surfaces a recurring phrase.
    const m1 = "list contents of home folder";
    const sid = createSession(db, { title: "" }).id;
    appendMessage(db, { sessionId: sid, role: "user", content: m1 });
    appendMessage(db, { sessionId: sid, role: "user", content: m1 });
    setCachedLabel(db, "d1", hashPrompt(m1), "List home folder",
      NOW + 24 * 3600_000);

    const chips = generateChips({ db, deviceId, memoryDir: memDir, now: NOW });
    const labels = chips.map((c) => c.label);
    expect(labels).toContain("List home folder");
  });
});
