import { describe, expect, it } from "vitest";
import { openInMemoryDb } from "../state/db.js";
import { appendMessage } from "../state/messages.js";
import { createSession } from "../state/sessions.js";
import { MemoryIndexService } from "./store.js";

function setup() {
  const db = openInMemoryDb();
  const service = new MemoryIndexService(db, null);
  return { db, service };
}

async function memory(
  fixture: ReturnType<typeof setup>,
  input: {
    title: string;
    summary: string;
    project?: string;
    privacyLevel?: "personal" | "project";
  },
) {
  const session = createSession(fixture.db, { title: input.title });
  const first = appendMessage(fixture.db, {
    sessionId: session.id,
    role: "user",
    content: `Develop the ${input.title} idea.`,
  });
  const last = appendMessage(fixture.db, {
    sessionId: session.id,
    role: "assistant",
    content: input.summary,
  });
  const captured = await fixture.service.capture({
    sessionId: session.id,
    fromMessageId: first.id,
    throughMessageId: last.id,
    kind: "idea",
    title: input.title,
    summary: input.summary,
    tags: input.title.toLocaleLowerCase().split(/\s+/),
    project: input.project,
    privacyLevel: input.privacyLevel,
  });
  return { session, first, last, ...captured.result };
}

describe("semantic memory governance", () => {
  it("applies an immutable sanitized correction and rejects stale writes", async () => {
    const f = setup();
    const original = await memory(f, {
      title: "Blue launch plan",
      summary: "The launch happens on Monday with a blue release train.",
    });
    const corrected = await f.service.correct({
      threadId: original.lineage.threadId,
      entryId: original.entry.id,
      expectedVersion: original.governance.threadVersion,
      actor: "user",
      reason: "Niko corrected the agreed launch day.",
      requestKey: "correct-blue-v1",
      correction: {
        summary: "The launch happens on Tuesday with a blue release train. OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456",
        conclusions: ["Tuesday is the agreed launch day"],
      },
    });
    expect(corrected.ok).toBe(true);
    if (!corrected.ok) return;
    expect(corrected.result).toMatchObject({
      entry: { summary: expect.stringContaining("Tuesday") },
      originalEntry: { summary: expect.stringContaining("Monday") },
      governance: { corrected: true, threadVersion: 2, state: "current", retrievalEligible: true },
    });
    expect(corrected.result.entry.summary).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    const row = f.db.prepare("SELECT summary FROM memory_index_entries WHERE id = ?")
      .get(original.entry.id) as { summary: string };
    expect(row.summary).toContain("Monday");
    expect(f.db.prepare("SELECT COUNT(*) AS count FROM memory_index_governance_events").get()).toEqual({ count: 1 });

    const replay = await f.service.correct({
      threadId: original.lineage.threadId,
      entryId: original.entry.id,
      expectedVersion: original.governance.threadVersion,
      actor: "user",
      reason: "Niko corrected the agreed launch day.",
      requestKey: "correct-blue-v1",
      correction: { summary: "Replay payload is ignored." },
    });
    expect(replay.ok && replay.event.id).toBe(corrected.event.id);
    expect(f.db.prepare("SELECT COUNT(*) AS count FROM memory_index_governance_events").get()).toEqual({ count: 1 });

    const stale = await f.service.correct({
      threadId: original.lineage.threadId,
      entryId: original.entry.id,
      expectedVersion: 1,
      actor: "user",
      reason: "Stale correction.",
      requestKey: "correct-blue-stale",
      correction: { summary: "This must not land." },
    });
    expect(stale).toMatchObject({ ok: false, reason: "version_conflict", currentVersion: 2 });

    const second = await f.service.correct({
      threadId: original.lineage.threadId,
      entryId: original.entry.id,
      expectedVersion: 2,
      actor: "user",
      reason: "Niko added a retrieval tag without changing the corrected summary.",
      requestKey: "correct-blue-v2",
      correction: { tags: ["launch", "tuesday"] },
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.result.entry).toMatchObject({
      summary: expect.stringContaining("Tuesday"),
      conclusions: ["Tuesday is the agreed launch day"],
      tags: ["launch", "tuesday"],
    });
    expect(second.result.originalEntry).toMatchObject({
      summary: expect.stringContaining("Monday"),
    });
    expect(second.result.governance).toMatchObject({
      corrected: true,
      threadVersion: 3,
      correctionReason: "Niko added a retrieval tag without changing the corrected summary.",
    });
  });

  it("pins and unpins with version guards and changes current-result ordering", async () => {
    const f = setup();
    const older = await memory(f, { title: "Pinned database plan", summary: "Use SQLite for the pinned database plan." });
    const newer = await memory(f, { title: "Other database plan", summary: "Use SQLite for the other database plan." });
    const pinned = f.service.setPinned({
      threadId: older.lineage.threadId,
      expectedVersion: older.governance.threadVersion,
      pinned: true,
      actor: "user",
      reason: "Keep this design prominent.",
      requestKey: "pin-older",
    });
    expect(pinned.ok && pinned.result.governance.pinned).toBe(true);
    const recent = f.service.listRecent();
    expect(recent.results[0]?.lineage.threadId).toBe(older.lineage.threadId);
    const found = await f.service.search("SQLite database plan");
    expect(found.results[0]?.lineage.threadId).toBe(older.lineage.threadId);

    if (!pinned.ok) return;
    const unpinned = f.service.setPinned({
      threadId: older.lineage.threadId,
      expectedVersion: pinned.result.governance.threadVersion,
      pinned: false,
      actor: "user",
      reason: "It no longer needs priority.",
      requestKey: "unpin-older",
    });
    expect(unpinned.ok && unpinned.result.governance.pinned).toBe(false);
    expect(newer.entry.id).not.toBe(older.entry.id);

    const crossThreadReplay = f.service.setPinned({
      threadId: newer.lineage.threadId,
      expectedVersion: newer.governance.threadVersion,
      pinned: true,
      actor: "user",
      reason: "A reused request key must not cross thread boundaries.",
      requestKey: "pin-older",
    });
    expect(crossThreadReplay).toMatchObject({ ok: false, reason: "invalid_state" });
  });

  it("supersedes an obsolete thread without hiding its immutable history", async () => {
    const f = setup();
    const obsolete = await memory(f, { title: "Old retention policy", summary: "Retain details for ten days." });
    const replacement = await memory(f, { title: "Current retention policy", summary: "Retain details for thirty days." });
    const superseded = f.service.supersede({
      threadId: obsolete.lineage.threadId,
      expectedVersion: obsolete.governance.threadVersion,
      replacementThreadId: replacement.lineage.threadId,
      replacementExpectedVersion: replacement.governance.threadVersion,
      actor: "user",
      reason: "The approved thirty-day policy replaces the old proposal.",
      requestKey: "supersede-retention",
    });
    expect(superseded.ok).toBe(true);
    if (!superseded.ok) return;
    expect(superseded.result.governance).toMatchObject({
      state: "superseded",
      retrievalEligible: false,
      supersededByThreadId: replacement.lineage.threadId,
    });
    const normal = await f.service.search("retention policy days");
    expect(normal.results.map((item) => item.lineage.threadId)).toEqual([replacement.lineage.threadId]);
    expect(normal.suppressedByGovernance).toBe(1);
    const history = await f.service.search("retention policy days", { includeHistory: true });
    expect(history.results).toHaveLength(2);
    expect(history.results.find((item) => item.lineage.threadId === obsolete.lineage.threadId)?.governance.state).toBe("superseded");
  });

  it("suppresses both sides of an unresolved conflict and resolves to one verified winner", async () => {
    const f = setup();
    const left = await memory(f, { title: "Cache strategy alpha", summary: "The cache lifetime is five minutes." });
    const right = await memory(f, { title: "Cache strategy beta", summary: "The cache lifetime is thirty minutes." });
    const opened = f.service.openConflict({
      threadId: left.lineage.threadId,
      expectedVersion: left.governance.threadVersion,
      otherThreadId: right.lineage.threadId,
      otherExpectedVersion: right.governance.threadVersion,
      actor: "user",
      reason: "These retained cache decisions contradict each other.",
      requestKey: "cache-conflict",
    });
    expect(opened.ok).toBe(true);
    const suppressed = await f.service.search("cache lifetime minutes");
    expect(suppressed.results).toHaveLength(0);
    expect(suppressed.suppressedByGovernance).toBe(2);
    if (!opened.ok) return;
    const third = await memory(f, { title: "Cache strategy gamma", summary: "The cache lifetime is one hour." });
    const nested = f.service.openConflict({
      threadId: left.lineage.threadId,
      expectedVersion: opened.result.governance.threadVersion,
      otherThreadId: third.lineage.threadId,
      otherExpectedVersion: third.governance.threadVersion,
      actor: "user",
      reason: "Do not create an ambiguous multi-party conflict projection.",
      requestKey: "cache-conflict-nested",
    });
    expect(nested).toMatchObject({ ok: false, reason: "invalid_state" });
    const pinConflict = f.service.setPinned({
      threadId: left.lineage.threadId,
      expectedVersion: opened.result.governance.threadVersion,
      pinned: true,
      actor: "user",
      reason: "A conflict cannot be promoted before resolution.",
      requestKey: "cache-conflict-pin",
    });
    expect(pinConflict).toMatchObject({ ok: false, reason: "invalid_state" });
    const rightState = f.service.get(right.entry.id)!;
    const resolved = f.service.resolveConflict({
      threadId: left.lineage.threadId,
      expectedVersion: opened.result.governance.threadVersion,
      losingThreadId: right.lineage.threadId,
      losingExpectedVersion: rightState.governance.threadVersion,
      actor: "user",
      reason: "Five minutes is the currently approved cache policy.",
      requestKey: "cache-resolve",
    });
    expect(resolved.ok).toBe(true);
    const current = await f.service.search("cache lifetime minutes");
    expect(current.results.map((item) => item.lineage.threadId)).toContain(left.lineage.threadId);
    expect(current.results.map((item) => item.lineage.threadId)).not.toContain(right.lineage.threadId);
    expect(f.service.get(right.entry.id)?.governance).toMatchObject({
      state: "superseded",
      supersededByThreadId: left.lineage.threadId,
    });
  });

  it("blocks cross-project governance and leaves changed sources unusable after correction", async () => {
    const f = setup();
    const alpha = await memory(f, {
      title: "Alpha vault",
      summary: "Alpha uses its private vault.",
      project: "alpha",
      privacyLevel: "project",
    });
    const beta = await memory(f, {
      title: "Beta vault",
      summary: "Beta uses its private vault.",
      project: "beta",
      privacyLevel: "project",
    });
    const outside = f.service.setPinned({
      threadId: alpha.lineage.threadId,
      expectedVersion: alpha.governance.threadVersion,
      pinned: true,
      actor: "user",
      reason: "Attempt outside scope.",
      requestKey: "pin-alpha-outside",
      project: "beta",
    });
    expect(outside).toMatchObject({ ok: false, reason: "privacy_scope" });
    const cross = f.service.supersede({
      threadId: alpha.lineage.threadId,
      expectedVersion: alpha.governance.threadVersion,
      replacementThreadId: beta.lineage.threadId,
      replacementExpectedVersion: beta.governance.threadVersion,
      actor: "user",
      reason: "Cross-scope replacement must fail.",
      requestKey: "cross-project-supersede",
      project: "alpha",
    });
    expect(cross).toMatchObject({ ok: false, reason: "not_found" });

    const corrected = await f.service.correct({
      threadId: alpha.lineage.threadId,
      entryId: alpha.entry.id,
      expectedVersion: alpha.governance.threadVersion,
      actor: "user",
      reason: "Clarify the alpha vault wording.",
      requestKey: "correct-alpha",
      project: "alpha",
      correction: { summary: "Alpha uses an isolated private vault." },
    });
    expect(corrected.ok).toBe(true);
    f.db.prepare("UPDATE messages SET content = 'changed after capture' WHERE id = ?").run(alpha.first.id);
    const changed = f.service.get(alpha.entry.id, { project: "alpha" });
    expect(changed).toMatchObject({ usable: false, governance: { corrected: true } });
  });
});
