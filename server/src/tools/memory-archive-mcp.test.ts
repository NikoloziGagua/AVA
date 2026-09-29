import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openInMemoryDb } from "../state/db.js";
import type { Db } from "../state/db.js";
import { MemoryArchive } from "../memory-archive/archive.js";
import { buildMemoryArchiveTools } from "./memory-archive-mcp.js";
import { buildMemoryTools } from "./memory-mcp.js";
import type { ToolDef } from "./ava-mcp.js";

const T0 = Date.parse("2026-09-24T13:00:00Z");

function setup() {
  const db = openInMemoryDb();
  db.prepare("INSERT INTO sessions (id, title, created_at, updated_at, origin) VALUES ('s1', 'Voice chat', ?, ?, 'human')").run(T0, T0);
  const say = (id: number, role: "user" | "assistant", content: string) => db.prepare(
    "INSERT INTO messages (id, session_id, role, content, metadata, created_at) VALUES (?, 's1', ?, ?, '{}', ?)",
  ).run(id, role, content, T0 + id * 60_000);
  const archive = new MemoryArchive(db, () => T0 + 1_000 * 60_000);
  const memoryDir = mkdtempSync(join(tmpdir(), "ava-memtools-"));
  const tools = new Map(buildMemoryArchiveTools({ db, archive, memoryDir, sessionId: "s1" }).map((def) => [def.tool.name, def]));
  const call = (name: string, args: Record<string, unknown>) => (tools.get(name) as ToolDef).run(args, {} as never);
  return { db, archive, say, call, memoryDir };
}

function seedNiko(db: Db, id: number, text: string) {
  db.prepare("INSERT INTO messages (id, session_id, role, content, metadata, created_at) VALUES (?, 's1', 'user', ?, '{}', ?)")
    .run(id, text, T0 + id * 60_000);
}

describe("memory v2 tools", () => {
  afterEach(() => { delete process.env.AVA_MEMORY_V2; });

  it("remembers at once, cites Niko's message, and returns a Saved card from the stored record", async () => {
    const { say, call, archive } = setup();
    say(1, "user", "My moms name is teo remember that");
    const result = await call("memory_remember", { text: "Niko's mother's name is Teo.", kind: "fact", topic: "mother's name" });
    expect(result).toMatchObject({ ok: true, saved: { kind: "memory", title: "Niko's mother's name is Teo." } });
    expect(result.text).toMatch(/^Remembered: \[mem_/);
    expect(archive.current()[0]).toMatchObject({ speechAct: "requested", origin: "explicit", sourceMessageIds: [1], saidAt: T0 + 60_000 });
    const again = await call("memory_remember", { text: "Niko's mother's name is Teo.", kind: "fact", topic: "mother's name" });
    expect(again).toMatchObject({ ok: true });
    expect(again.saved).toBeUndefined();
  });

  it("corrects by description, keeps history, and asks when a description is ambiguous", async () => {
    const { say, call, archive, db } = setup();
    say(1, "user", "gym is at 6");
    await call("memory_remember", { text: "Niko goes to the gym at 6 pm.", kind: "fact", topic: "gym time" });
    await call("memory_remember", { text: "Niko's gym bag is blue.", kind: "fact", topic: "gym bag" });
    seedNiko(db, 2, "no, gym is at 7 now");
    const vague = await call("memory_correct", { about: "gym", text: "Niko goes to the gym at 7 pm." });
    expect(vague.ok).toBe(false);
    expect(vague.text).toContain("More than one memory could match");
    const id = archive.search("gym time").find((hit) => hit.record.topic === "gym time")!.record.id;
    const fixed = await call("memory_correct", { id, text: "Niko goes to the gym at 7 pm." });
    expect(fixed.text).toContain("which is kept as history");
    expect(archive.current().map((record) => record.text)).toEqual(["Niko's gym bag is blue.", "Niko goes to the gym at 7 pm."]);
  });

  it("forgets for good and reads the result back", async () => {
    const { say, call, archive } = setup();
    say(1, "user", "remember my code word is pelican");
    await call("memory_remember", { text: "Niko's code word is pelican.", kind: "fact", topic: "code word" });
    const forgotten = await call("memory_forget", { about: "code word pelican" });
    expect(forgotten).toMatchObject({ ok: true });
    expect(forgotten.text).toContain("Don't repeat what it said");
    expect(archive.counts()).toMatchObject({ active: 0, history: 0, forgotten: 1 });
    expect((await call("memory_recall", { query: "code word" })).text).toContain("Nothing in memory or past conversations matches");
  });

  it("stops carrying without erasing, in both senses", async () => {
    const { say, call, archive } = setup();
    say(1, "user", "calendar and notes are the top priorities");
    await call("memory_remember", { text: "Calendar and Notes are Niko's top AVA priorities.", kind: "project", topic: "AVA priorities" });
    await call("memory_remember", { text: "Niko has an exam in December.", kind: "commitment", topic: "exam" });
    const done = await call("memory_stop_carrying", { about: "AVA priorities", because: "no_longer_true" });
    expect(done.text).toContain("Now history");
    const quiet = await call("memory_stop_carrying", { about: "exam December", because: "dont_bring_up" });
    expect(quiet.text).toContain("stop bringing it up");
    expect(archive.current({ carriedOnly: true })).toEqual([]);
    expect(archive.counts()).toMatchObject({ active: 1, history: 1 });
  });

  it("recalls memories with their sources, then past conversation, never forgotten or automated lines", async () => {
    const { say, call, archive, db } = setup();
    say(1, "user", "I'm looking at a mobile tyre fitting van business in Dublin");
    say(2, "assistant", "For a small start, Stripe suits a tyre business better than Adyen.");
    say(3, "user", "[CODEX CYCLE PLANNING] tyre business Stripe notes");
    say(4, "user", "remember my tyre supplier code is 7788");
    archive.add({ kind: "project", topic: "tyre business", text: "Niko is exploring a mobile tyre-fitting van business in Dublin.",
      speechAct: "stated", confidence: "high", origin: "conversation", saidAt: T0 + 60_000, sourceMessageIds: [1] }, "extractor");
    const secret = archive.add({ kind: "fact", topic: "supplier code", text: "Niko's tyre supplier code is 7788.",
      speechAct: "requested", confidence: "high", origin: "explicit", saidAt: T0 + 4 * 60_000, sourceMessageIds: [4] }, "niko");
    if (!secret.ok) throw new Error("setup failed");
    archive.forget(secret.record.id, "niko");
    const text = (await call("memory_recall", { query: "tyre business Stripe" })).text;
    expect(text).toContain("Niko is exploring a mobile tyre-fitting van business in Dublin. (Niko said Thu 24 Sep 2026 14:01)");
    expect(text).toContain('source #1, Niko');
    expect(text).toContain("#2 AVA");
    expect(text).not.toContain("CODEX CYCLE");
    expect(text).not.toContain("7788");
    expect(db.prepare("SELECT count(*) AS n FROM memory_records").get()).toEqual({ n: 1 });
  });

  it("replaces the file-based tools only when memory v2 is on", () => {
    const db = openInMemoryDb();
    const archive = new MemoryArchive(db);
    const memoryDir = mkdtempSync(join(tmpdir(), "ava-memtools-switch-"));
    const names = () => buildMemoryTools({ memoryDir, db, archive, sessionId: null }).map((def) => def.tool.name);
    expect(names()).toContain("memory_remember");
    expect(names()).not.toContain("memory_recall");
    process.env.AVA_MEMORY_V2 = "on";
    expect(names()).toEqual(expect.arrayContaining(["memory_recall", "memory_list", "memory_remember", "memory_correct", "memory_forget", "memory_stop_carrying", "memory_read"]));
  });
});
