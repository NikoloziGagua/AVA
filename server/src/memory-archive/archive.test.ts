import { describe, expect, it } from "vitest";
import { openInMemoryDb } from "../state/db.js";
import { MemoryArchive, ftsQuery, topicFingerprint } from "./archive.js";
import type { MemoryChange, NewMemory } from "./types.js";

const DAY = 86_400_000;
const T0 = Date.parse("2026-09-01T12:00:00Z");

function setup(now = T0 + 30 * DAY) {
  const db = openInMemoryDb();
  const archive = new MemoryArchive(db, () => now);
  const changes: MemoryChange[] = [];
  archive.subscribe((change) => changes.push(change));
  return { db, archive, changes };
}

function memory(over: Partial<NewMemory> = {}): NewMemory {
  return {
    kind: "fact", topic: "gym time", text: "Niko trains at the gym at 6 pm.", speechAct: "stated",
    confidence: "high", origin: "conversation", saidAt: T0, sourceMessageIds: [10], ...over,
  };
}

describe("memory archive", () => {
  it("stores a record, reads it back, finds it, and ignores an exact repeat", () => {
    const { archive, changes } = setup();
    const first = archive.add(memory(), "extractor");
    expect(first).toMatchObject({ ok: true, outcome: "added", record: { status: "active", sourceMessageIds: [10], saidAt: T0 } });
    expect(archive.add(memory({ saidAt: T0 + DAY }), "extractor")).toMatchObject({ ok: true, outcome: "unchanged" });
    expect(archive.search("when does Niko go to the gym?").map((hit) => hit.record.text)).toEqual(["Niko trains at the gym at 6 pm."]);
    expect(changes.map((change) => change.action)).toEqual(["added"]);
  });

  it("lets the newer statement win and keeps the older one as dated history", () => {
    const { archive } = setup();
    const old = archive.add(memory(), "extractor");
    const next = archive.add(memory({ text: "Niko trains at the gym at 7 pm.", saidAt: T0 + 5 * DAY, sourceMessageIds: [20] }), "extractor");
    expect(next).toMatchObject({ ok: true, outcome: "replaced" });
    if (!old.ok || !next.ok) throw new Error("setup failed");
    expect(archive.get(old.record.id)).toMatchObject({ status: "history", validTo: T0 + 5 * DAY, supersededById: next.record.id });
    expect(archive.current().map((record) => record.text)).toEqual(["Niko trains at the gym at 7 pm."]);
    expect(archive.chain(next.record.id).map((record) => record.text))
      .toEqual(["Niko trains at the gym at 6 pm.", "Niko trains at the gym at 7 pm."]);
    // Topic wording that differs only in order and filler is the same topic.
    expect(topicFingerprint("Niko's gym time")).toBe(topicFingerprint("time of gym"));
  });

  it("files older news that arrives late straight into history", () => {
    const { archive } = setup();
    archive.add(memory({ text: "Niko trains at the gym at 7 pm.", saidAt: T0 + 5 * DAY }), "backfill");
    const late = archive.add(memory({ saidAt: T0, sourceMessageIds: [5] }), "backfill");
    expect(late).toMatchObject({ ok: true, record: { status: "history", validTo: T0 + 5 * DAY } });
    expect(archive.current().map((record) => record.text)).toEqual(["Niko trains at the gym at 7 pm."]);
  });

  it("corrects with a version guard and never overwrites", () => {
    const { archive } = setup();
    const first = archive.add(memory(), "niko");
    if (!first.ok) throw new Error("setup failed");
    expect(archive.correct(first.record.id, { text: "x", saidAt: T0, origin: "explicit", expectedVersion: 9 }, "niko"))
      .toMatchObject({ ok: false, reason: "stale" });
    const fixed = archive.correct(first.record.id, { text: "Niko trains at 8 pm.", saidAt: T0 + DAY, origin: "explicit" }, "niko");
    expect(fixed).toMatchObject({ ok: true, outcome: "replaced", record: { supersedesId: first.record.id, status: "active" } });
    expect(archive.correct(first.record.id, { text: "again", saidAt: T0 + DAY, origin: "explicit" }, "niko"))
      .toMatchObject({ ok: false, reason: "wrong_state" });
  });

  it("forgets every version and the whole topic, and nothing automatic can bring it back", () => {
    const { archive, changes, db } = setup();
    const first = archive.add(memory({ topic: "code word", text: "Niko's code word is pelican.", sourceMessageIds: [30] }), "niko");
    archive.add(memory({ topic: "code word", text: "Niko's code word is falcon.", saidAt: T0 + DAY, sourceMessageIds: [31] }), "niko");
    if (!first.ok) throw new Error("setup failed");
    expect(archive.forget(first.record.id, "niko")).toEqual({ ok: true, forgotten: 2 });
    expect(archive.current()).toEqual([]);
    expect(archive.search("code word pelican", { includeHistory: true })).toEqual([]);
    // Re-reading the same messages, rewording, or the same topic: all refused.
    expect(archive.add(memory({ topic: "code word", text: "Niko's code word is pelican.", sourceMessageIds: [30] }), "backfill"))
      .toMatchObject({ ok: false, reason: "forgotten" });
    expect(archive.add(memory({ topic: "secret word", text: "His secret word: pelican", sourceMessageIds: [30] }), "backfill"))
      .toMatchObject({ ok: false, reason: "forgotten" });
    expect(archive.add(memory({ topic: "Niko's code word", text: "The word is heron.", sourceMessageIds: [99] }), "extractor"))
      .toMatchObject({ ok: false, reason: "forgotten" });
    expect(archive.forgottenMessageIds([30, 31, 32])).toEqual(new Set([30, 31]));
    // The feed keeps that something was forgotten, never what.
    const summaries = db.prepare("SELECT summary FROM memory_record_events").all() as Array<{ summary: string | null }>;
    expect(summaries.every((row) => row.summary === null)).toBe(true);
    expect(changes.filter((change) => change.action === "forgotten").every((change) => change.record === null)).toBe(true);
    // Niko saying it again himself is allowed.
    expect(archive.add(memory({ topic: "code word", text: "Niko's code word is heron.", origin: "explicit", sourceMessageIds: [40] }), "niko"))
      .toMatchObject({ ok: true, outcome: "added" });
  });

  it("stops carrying without deleting, and ends without a replacement", () => {
    const { archive } = setup();
    const kept = archive.add(memory({ kind: "project", topic: "top priorities", text: "Calendar and Notes are the top priorities." }), "extractor");
    if (!kept.ok) throw new Error("setup failed");
    archive.setCarry(kept.record.id, false, "niko");
    expect(archive.current({ carriedOnly: true })).toEqual([]);
    expect(archive.search("priorities")).toHaveLength(1);
    const ended = archive.end(kept.record.id, T0 + 2 * DAY, "niko");
    expect(ended).toMatchObject({ ok: true, record: { status: "history", validTo: T0 + 2 * DAY, supersededById: null } });
    expect(archive.endedSince(T0 + DAY).map((record) => record.id)).toEqual([kept.record.id]);
  });

  it("keeps unconfirmed records out of current memory until Niko confirms", () => {
    const { archive } = setup();
    archive.add(memory({ kind: "person", topic: "Bendy", text: "Bendy is Niko's friend.", saidAt: T0 }), "extractor");
    const waiting = archive.add(memory({ kind: "person", topic: "Bendy", text: "Bendy is Niko's friend from school.", saidAt: T0 + DAY, status: "unconfirmed" }), "extractor");
    if (!waiting.ok) throw new Error("setup failed");
    expect(archive.current().map((record) => record.text)).toEqual(["Bendy is Niko's friend."]);
    expect(archive.confirm(waiting.record.id, "niko")).toMatchObject({ ok: true, outcome: "confirmed", record: { status: "active" } });
    expect(archive.current().map((record) => record.text)).toEqual(["Bendy is Niko's friend from school."]);
  });

  it("honors a forget from the older memory index by message id alone", () => {
    const { archive } = setup();
    expect(archive.tombstoneMessages([50, 51], "forgotten_index_entry")).toBe(2);
    expect(archive.tombstoneMessages([51], "forgotten_index_entry")).toBe(0);
    expect(archive.add(memory({ kind: "decision", sourceMessageIds: [51] }), "backfill")).toMatchObject({ ok: false, reason: "forgotten" });
    expect(archive.add(memory({ sourceMessageIds: [52] }), "backfill")).toMatchObject({ ok: true });
  });

  it("ranks current above history and builds safe search queries", () => {
    const { archive } = setup();
    archive.add(memory({ text: "Niko trains at the gym at 6 pm." }), "extractor");
    archive.add(memory({ text: "Niko trains at the gym at 7 pm.", saidAt: T0 + DAY }), "extractor");
    const hits = archive.search("gym", { includeHistory: true });
    expect(hits.map((hit) => hit.record.status)).toEqual(["active", "history"]);
    expect(ftsQuery("what's \"my\" mom's name?")).toBe('"mom" OR "name"*');
    expect(ftsQuery("what is it")).toBeNull();
  });
});
