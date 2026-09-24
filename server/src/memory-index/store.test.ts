import { describe, expect, it } from "vitest";
import { openInMemoryDb } from "../state/db.js";
import { createSession, softDeleteSession } from "../state/sessions.js";
import { appendMessage } from "../state/messages.js";
import { MemoryIndexService } from "./store.js";
import type { MemoryEmbedder, MemoryEmbedding } from "./types.js";

class FakeEmbedder implements MemoryEmbedder {
  readonly provider = "test";
  readonly model = "semantic-fixture-v1";
  readonly inputs: string[] = [];
  fail = false;

  async embed(text: string): Promise<MemoryEmbedding> {
    this.inputs.push(text);
    if (this.fail) throw new Error("fixture unavailable");
    const normalized = text.toLocaleLowerCase();
    const vector = /durable recall|knowledge archive|memory retrieval/.test(normalized)
      ? [1, 0, 0]
      : /voice persona|friendly assistant/.test(normalized)
        ? [0, 1, 0]
        : [0, 0, 1];
    return { provider: this.provider, model: this.model, vector };
  }
}

function conversation() {
  const db = openInMemoryDb();
  const session = createSession(db, { title: "Memory architecture" });
  const first = appendMessage(db, {
    sessionId: session.id,
    role: "user",
    content: "We need a durable knowledge archive for research and ideas.",
  });
  appendMessage(db, {
    sessionId: session.id,
    role: "assistant",
    content: "Use compact summaries for discovery and verify the source before answering.",
  });
  const last = appendMessage(db, {
    sessionId: session.id,
    role: "user",
    content: "Agreed. SQLite remains authoritative and embeddings are pointers.",
  });
  return { db, session, first, last };
}

async function capture(service: MemoryIndexService, source: ReturnType<typeof conversation>, over: Record<string, unknown> = {}) {
  return service.capture({
    sessionId: source.session.id,
    fromMessageId: source.first.id,
    throughMessageId: source.last.id,
    kind: "idea",
    title: "Durable memory retrieval",
    summary: "Build a source-verified knowledge archive with hybrid memory retrieval.",
    conclusions: ["SQLite is canonical", "Embeddings only locate source material"],
    openQuestions: ["When should automatic indexing begin?"],
    nextSteps: ["Prove explicit capture and cross-chat recall"],
    tags: ["memory", "RAG", "research"],
    ...(over as object),
  });
}

async function newerNoise(service: MemoryIndexService, source: ReturnType<typeof conversation>, count = 550) {
  source.db.prepare("UPDATE memory_index_entries SET updated_at = 1000").run();
  for (let i = 0; i < count; i++) {
    const message = appendMessage(source.db, { sessionId: source.session.id, role: "user", content: `Meal planning fixture ${i}.` });
    const item = await service.capture({ sessionId: source.session.id, fromMessageId: message.id, throughMessageId: message.id,
      kind: "idea", title: `Meal planning ${i}`, summary: "Choose seasonal vegetables for dinner." });
    source.db.prepare("UPDATE memory_index_entries SET updated_at = ? WHERE id = ?").run(10_000 + i, item.result.entry.id);
    source.db.prepare("UPDATE memory_index_thread_state SET updated_at = ? WHERE thread_id = ?").run(10_000 + i, item.result.lineage.threadId);
  }
}

describe("complete memory candidate ranking", () => {
  it("finds and pins an older match beyond 500 newer records, with stable capped output and bounded source checks", async () => {
    const source = conversation();
    const service = new MemoryIndexService(source.db, null);
    const old = (await capture(service, source)).result;
    await newerNoise(service, source);
    // Legacy rows without an explicit lineage use their own ID as the thread.
    source.db.prepare("UPDATE memory_index_entries SET thread_id = NULL WHERE id = ?").run(old.entry.id);
    expect(service.setPinned({ threadId: old.lineage.threadId, expectedVersion: old.governance.threadVersion,
      actor: "user", reason: "Keep this important idea", requestKey: "pin-older", pinned: true }).ok).toBe(true);

    const found = await service.search("Durable memory retrieval", { limit: 1, latestOnly: true });
    expect(found.results.map(item => item.entry.id)).toEqual([old.entry.id]);
    expect(found).toMatchObject({ mode: "lexical", semanticAvailable: false });
    expect(found.results[0]).toMatchObject({ usable: true, source: { status: "verified" } });
    source.db.prepare("UPDATE memory_index_sources SET last_verified_at = NULL").run();
    const recent = service.listRecent({ limit: 5000 });
    expect(recent.results).toHaveLength(50);
    expect(recent.results[0]?.entry.id).toBe(old.entry.id);
    expect(source.db.prepare("SELECT COUNT(*) AS count FROM memory_index_sources WHERE last_verified_at IS NOT NULL").get()).toEqual({ count: 50 });
    expect(service.listRecent({ limit: 5000 }).results.map(item => item.entry.id)).toEqual(recent.results.map(item => item.entry.id));
    expect((await service.search("Meal planning", { limit: 5000 })).results).toHaveLength(20);
    expect(service.listRecent({ limit: Number.NaN }).results).toEqual([]);
    expect((await service.search("Meal planning", { limit: Number.NaN })).results).toEqual([]);
  });

  it("finds an older semantic-only paraphrase and honestly falls back when embeddings fail", async () => {
    const source = conversation();
    const embedder = new FakeEmbedder();
    const service = new MemoryIndexService(source.db, embedder);
    const old = (await capture(service, source, { title: "Durable recall", summary: "Storage for cross-session durable recall.",
      conclusions: [], openQuestions: [], nextSteps: [], tags: [] })).result;
    await newerNoise(service, source);
    const result = await service.search("knowledge archive", { latestOnly: true });
    expect(result.results.map(item => item.entry.id)).toEqual([old.entry.id]);
    expect(result.results[0]?.match).toMatchObject({ mode: "semantic", lexicalScore: 0, semanticScore: 1 });
    embedder.fail = true;
    const fallback = await service.search("Durable recall", { latestOnly: true });
    expect(fallback).toMatchObject({ mode: "lexical", semanticAvailable: false });
    expect(fallback.notice).toContain("unavailable");
    expect(fallback.results[0]?.entry.id).toBe(old.entry.id);
  });

  it("applies scoped corrections between searches without cached governance, then rejects changed/deleted source evidence", async () => {
    const source = conversation();
    const service = new MemoryIndexService(source.db, null);
    const old = (await capture(service, source, { project: "Aurora", privacyLevel: "project" })).result;
    await newerNoise(service, source);
    expect((await service.search("Durable memory retrieval")).results).toEqual([]);
    expect((await service.search("Durable memory retrieval", { project: "Other" })).results).toEqual([]);
    expect((await service.search("Durable memory retrieval", { project: "aurora" })).results[0]?.entry.id).toBe(old.entry.id);
    const corrected = await service.correct({ threadId: old.lineage.threadId, entryId: old.entry.id,
      expectedVersion: old.governance.threadVersion, actor: "user", reason: "Correct the current topic",
      requestKey: "older-correction", project: "Aurora", correction: { title: "Origami satellite", summary: "Origami satellite revised." } });
    expect(corrected.ok).toBe(true);
    const changed = await service.search("Origami satellite", { project: "Aurora" });
    expect(changed.results[0]).toMatchObject({ entry: { id: old.entry.id, title: "Origami satellite" },
      originalEntry: { title: old.entry.title }, governance: { corrected: true, threadVersion: 2 } });
    expect(changed.results[0]?.governance.events).toHaveLength(1);
    expect((await service.search("Origami satellite", { project: "Other" })).results).toEqual([]);
    source.db.prepare("UPDATE messages SET content = 'unexpected rewrite' WHERE id = ?").run(source.first.id);
    expect((await service.search("Origami satellite", { project: "Aurora" })).results[0]).toMatchObject({ usable: false, source: { status: "changed" } });
    softDeleteSession(source.db, source.session.id);
    expect((await service.search("Origami satellite", { project: "Aurora" })).results[0]).toMatchObject({ usable: false, source: { status: "unavailable" } });
  });

  it("keeps only the latest eligible checkpoint beyond the cutoff, and does not resurrect conflicted or superseded threads", async () => {
    const source = conversation();
    const service = new MemoryIndexService(source.db, null);
    const old = (await capture(service, source)).result;
    const update = appendMessage(source.db, { sessionId: source.session.id, role: "user", content: "Revised durable memory retrieval plan." });
    const latest = (await capture(service, source, { throughMessageId: update.id, parentEntryId: old.entry.id,
      expectedParentVersion: old.entry.version, checkpointKind: "revision", summary: "Revised durable memory retrieval plan." })).result;
    const alternativeMessage = appendMessage(source.db, { sessionId: source.session.id, role: "user", content: "Alternative durable memory retrieval plan." });
    const alternative = (await capture(service, source, { fromMessageId: alternativeMessage.id, throughMessageId: alternativeMessage.id })).result;
    await newerNoise(service, source);
    const before = await service.search("Durable memory retrieval", { latestOnly: true });
    expect(before.results.map(item => item.entry.id).sort()).toEqual([latest.entry.id, alternative.entry.id].sort());
    const conflict = service.openConflict({ threadId: latest.lineage.threadId, expectedVersion: latest.governance.threadVersion,
      otherThreadId: alternative.lineage.threadId, otherExpectedVersion: alternative.governance.threadVersion,
      actor: "user", reason: "Competing plans", requestKey: "older-conflict" });
    expect(conflict.ok).toBe(true);
    const blocked = await service.search("Durable memory retrieval", { latestOnly: true });
    expect(blocked.results).toEqual([]);
    expect(blocked.suppressedByGovernance).toBe(2);
    const restored = service.resolveConflict({ threadId: latest.lineage.threadId,
      expectedVersion: service.get(latest.entry.id)!.governance.threadVersion, losingThreadId: alternative.lineage.threadId,
      losingExpectedVersion: service.get(alternative.entry.id)!.governance.threadVersion,
      actor: "user", reason: "Keep the revised plan", requestKey: "older-resolve" });
    expect(restored.ok).toBe(true);
    expect((await service.search("Durable memory retrieval", { latestOnly: true })).results.map(item => item.entry.id)).toEqual([latest.entry.id]);
    expect((await service.search("Durable memory retrieval", { includeHistory: true })).results).toHaveLength(3);
    expect(service.forget(latest.entry.id, latest.entry.version)).toEqual({ ok: true });
    expect((await service.search("Durable memory retrieval", { latestOnly: true })).results.map(item => item.entry.id)).toEqual([old.entry.id]);
  });
});

describe("semantic memory index", () => {
  it("indexes only reachable committed improvements and reuses their immutable source", async () => {
    const source = conversation();
    const sha = "a".repeat(40);
    const embedder = new FakeEmbedder();
    const service = new MemoryIndexService(source.db, embedder, (candidate) => candidate === sha);
    const secret = "sk-proj-AbCdEf0123456789AbCdEf0123456789";
    const input = {
      commitSha: sha,
      sourceKind: "git_commit" as const,
      actor: "codex" as const,
      title: "Run genuine Microsoft UFO fixture",
      summary: `AVA can run one bounded local Notepad fixture. ${secret}`,
      capabilities: ["Microsoft UFO"],
      changedFiles: ["server/src/ufo/service.ts"],
      verification: ["Committed server tests and one benign Notepad smoke passed."],
      tags: ["ufo"],
      shippedAt: Date.UTC(2026, 7, 28),
    };

    const first = await service.captureImprovement(input);
    const replay = await service.captureImprovement(input);

    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(replay.result.entry.id).toBe(first.result.entry.id);
    expect(first.result).toMatchObject({
      entry: { kind: "improvement", captureMode: "automatic", title: input.title },
      source: { type: "improvement_record", status: "verified", commitSha: sha },
      usable: true,
    });
    expect(first.result.entry.summary).not.toContain(secret);
    const evidence = service.readSource(first.result.entry.id);
    expect(evidence?.messages[0]?.content).toContain(`Git commit: ${sha}`);
    expect(evidence?.messages[0]?.content).toContain("Microsoft UFO");
    expect(evidence?.messages[0]?.content).not.toContain(secret);
    expect(source.db.prepare("SELECT COUNT(*) AS count FROM improvement_records").get()).toEqual({ count: 1 });
    expect(source.db.prepare("SELECT COUNT(*) AS count FROM memory_index_entries WHERE kind = 'improvement'").get()).toEqual({ count: 1 });
  });

  it("fails closed for uncommitted improvements and conversation attempts to manufacture one", async () => {
    const source = conversation();
    const sha = "b".repeat(40);
    const service = new MemoryIndexService(source.db, null, () => false);

    await expect(service.captureImprovement({
      commitSha: sha,
      sourceKind: "git_commit",
      actor: "codex",
      title: "Uncommitted claim",
      summary: "This must not become durable product history.",
    })).rejects.toThrow(/not reachable/i);
    await expect(service.capture({
      sessionId: source.session.id,
      fromMessageId: source.first.id,
      throughMessageId: source.last.id,
      kind: "improvement",
      title: "Conversation claim",
      summary: "A conversation is not proof of a shipped improvement.",
    } as never)).rejects.toThrow(/immutable committed source/i);
    expect(source.db.prepare("SELECT COUNT(*) AS count FROM improvement_records").get()).toEqual({ count: 0 });
  });

  it("keeps tampered improvement evidence as history but marks it unusable", async () => {
    const source = conversation();
    const sha = "c".repeat(40);
    const service = new MemoryIndexService(source.db, null, () => true);
    const captured = await service.captureImprovement({
      commitSha: sha,
      sourceKind: "self_swap",
      actor: "ava",
      title: "Verified self improvement",
      summary: "AVA swapped a verified improvement into the committed branch.",
    });

    source.db.prepare("UPDATE improvement_records SET summary = 'rewritten after capture' WHERE commit_sha = ?").run(sha);
    expect(service.get(captured.result.entry.id)).toMatchObject({
      usable: false,
      source: { type: "improvement_record", status: "changed" },
    });
    expect(service.readSource(captured.result.entry.id)?.messages).toEqual([]);
  });

  it("stores a sanitized compact record, source fingerprint and embedding without duplicating transcript content", async () => {
    const source = conversation();
    const embedder = new FakeEmbedder();
    const service = new MemoryIndexService(source.db, embedder);
    const secret = "sk-proj-AbCdEf0123456789AbCdEf0123456789";
    const captured = await capture(service, source, {
      summary: `Use ${secret} only as a secret-scrubbing fixture; durable recall is the subject.`,
    });

    expect(captured.created).toBe(true);
    expect(captured.result.entry.embeddingStatus).toBe("ready");
    expect(captured.result.entry.captureMode).toBe("explicit");
    expect(captured.result.entry.captureReason).toBeNull();
    expect(captured.result.entry.summary).toContain("sk-***");
    expect(captured.result.entry.summary).not.toContain(secret);
    expect(captured.result.source.status).toBe("verified");
    expect(captured.result.source.messageCount).toBe(3);
    expect(embedder.inputs[0]).not.toContain(secret);

    const row = source.db.prepare("SELECT dimensions, length(vector) AS bytes FROM memory_index_embeddings")
      .get() as { dimensions: number; bytes: number };
    expect(row).toEqual({ dimensions: 3, bytes: 12 });
    const entry = source.db.prepare("SELECT summary FROM memory_index_entries").get() as { summary: string };
    expect(entry.summary).not.toContain(source.first.content);
  });

  it("retrieves different wording semantically across sessions and explains the match", async () => {
    const source = conversation();
    const service = new MemoryIndexService(source.db, new FakeEmbedder());
    await capture(service, source);
    createSession(source.db, { title: "A different chat" });

    const found = await service.search("How will the knowledge archive preserve long term recall?", { limit: 5 });
    expect(found.semanticAvailable).toBe(true);
    expect(found.mode).toBe("hybrid");
    expect(found.results).toHaveLength(1);
    expect(found.results[0]).toMatchObject({
      usable: true,
      source: { status: "verified" },
      match: { mode: "hybrid" },
    });
    expect(found.results[0]!.match.reason).toContain("semantic similarity");
    expect(found.results[0]!.match.reason).toContain("source is verified separately");
  });

  it("falls back to exact and keyword matching when embeddings are unavailable", async () => {
    const source = conversation();
    const service = new MemoryIndexService(source.db, null);
    const captured = await capture(service, source);
    expect(captured.result.entry.embeddingStatus).toBe("unavailable");

    const found = await service.search("SQLite canonical embeddings", { limit: 5 });
    expect(found.mode).toBe("lexical");
    expect(found.semanticAvailable).toBe(false);
    expect(found.notice).toContain("keyword");
    expect(found.results[0]!.match.sharedTerms).toEqual(expect.arrayContaining(["sqlite", "embedding"]));
  });

  it("degrades to lexical search if the configured embedding provider fails", async () => {
    const source = conversation();
    const embedder = new FakeEmbedder();
    const service = new MemoryIndexService(source.db, embedder);
    await capture(service, source);
    embedder.fail = true;

    const found = await service.search("SQLite canonical");
    expect(found.semanticAvailable).toBe(false);
    expect(found.mode).toBe("lexical");
    expect(found.notice).toContain("unavailable");
    expect(found.results).toHaveLength(1);
  });

  it("is idempotent for the same verified range and scope", async () => {
    const source = conversation();
    const service = new MemoryIndexService(source.db, new FakeEmbedder());
    const first = await capture(service, source);
    const second = await capture(service, source);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.result.entry.id).toBe(first.result.entry.id);
    const count = source.db.prepare("SELECT COUNT(*) AS count FROM memory_index_entries").get() as { count: number };
    expect(count.count).toBe(1);
  });

  it("appends immutable checkpoint lineage and rejects stale parent writes", async () => {
    const source = conversation();
    const service = new MemoryIndexService(source.db, null);
    const initial = await capture(service, source, {
      captureMode: "automatic",
      checkpointReason: "The idea reached its first durable shape.",
    });
    const decisionUser = appendMessage(source.db, {
      sessionId: source.session.id,
      role: "user",
      content: "Decision: use immutable linked checkpoints.",
    });
    const decisionAssistant = appendMessage(source.db, {
      sessionId: source.session.id,
      role: "assistant",
      content: "Each material change appends a child and preserves the prior compact state.",
    });
    const decision = await service.capture({
      sessionId: source.session.id,
      fromMessageId: source.first.id,
      throughMessageId: decisionAssistant.id,
      kind: "idea",
      title: "Durable memory retrieval",
      summary: "The current design adds immutable linked checkpoints to source-verified memory retrieval.",
      parentEntryId: initial.result.entry.id,
      expectedParentVersion: initial.result.entry.version,
      checkpointKind: "decision",
      checkpointReason: "The group chose append-only checkpoint history.",
      captureMode: "automatic",
    });

    expect(decision.result).toMatchObject({
      entry: {
        threadId: initial.result.entry.id,
        parentEntryId: initial.result.entry.id,
        checkpointSequence: 2,
        checkpointKind: "decision",
        checkpointReason: "The group chose append-only checkpoint history.",
      },
      lineage: { totalCheckpoints: 2, isLatest: true },
      source: { fromMessageId: source.first.id, throughMessageId: decisionAssistant.id },
    });
    expect(service.get(initial.result.entry.id)).toMatchObject({
      entry: { summary: initial.result.entry.summary, checkpointSequence: 1 },
      lineage: { totalCheckpoints: 2, isLatest: false },
    });

    const nextUser = appendMessage(source.db, { sessionId: source.session.id, role: "user", content: "Next step: test stale writes." });
    const nextAssistant = appendMessage(source.db, { sessionId: source.session.id, role: "assistant", content: "A stale parent must fail closed." });
    await expect(service.capture({
      sessionId: source.session.id,
      fromMessageId: source.first.id,
      throughMessageId: nextAssistant.id,
      kind: "idea",
      title: "Stale checkpoint",
      summary: "This write deliberately targets the old initial parent and must be rejected.",
      parentEntryId: initial.result.entry.id,
      expectedParentVersion: initial.result.entry.version,
      checkpointKind: "next_step",
      checkpointReason: "Stale fixture.",
    })).rejects.toThrow(/parent is stale/i);
    expect(source.db.prepare("SELECT COUNT(*) AS count FROM memory_index_entries").get()).toEqual({ count: 2 });
    expect(decisionUser.id).toBeLessThan(nextUser.id);
  });

  it("marks a changed or deleted authoritative source unusable", async () => {
    const changed = conversation();
    const changedService = new MemoryIndexService(changed.db, null);
    const captured = await capture(changedService, changed);
    changed.db.prepare("UPDATE messages SET content = 'unexpected rewrite' WHERE id = ?").run(changed.first.id);
    expect(changedService.get(captured.result.entry.id)).toMatchObject({
      usable: false,
      source: { status: "changed" },
    });

    const softDeleted = conversation();
    const softDeletedService = new MemoryIndexService(softDeleted.db, null);
    const hidden = await capture(softDeletedService, softDeleted);
    softDeleteSession(softDeleted.db, softDeleted.session.id);
    expect(softDeletedService.get(hidden.result.entry.id)).toMatchObject({
      usable: false,
      source: { status: "unavailable", sessionId: softDeleted.session.id },
    });

    const deleted = conversation();
    const deletedService = new MemoryIndexService(deleted.db, null);
    const second = await capture(deletedService, deleted);
    deleted.db.prepare("DELETE FROM sessions WHERE id = ?").run(deleted.session.id);
    expect(deletedService.get(second.result.entry.id)).toMatchObject({
      usable: false,
      source: { status: "unavailable", sessionId: null },
    });
  });

  it("enforces project privacy and never leaks one project's record into another", async () => {
    const source = conversation();
    const service = new MemoryIndexService(source.db, null);
    await capture(service, source, { project: "AVA", privacyLevel: "project" });

    expect((await service.search("SQLite canonical")).results).toHaveLength(0);
    expect((await service.search("SQLite canonical", { project: "Other" })).results).toHaveLength(0);
    expect((await service.search("SQLite canonical", { project: "ava" })).results).toHaveLength(1);
    const found = await service.search("SQLite canonical", { project: "ava" });
    const id = found.results[0]!.entry.id;
    expect(service.readSource(id)).toBeNull();
    expect(service.readSource(id, { project: "Other" })).toBeNull();
    expect(service.readSource(id, { project: "AVA" })?.messages).toHaveLength(3);
  });

  it("forgets with a version guard, removes the vector and prevents resurrection by duplicate capture", async () => {
    const source = conversation();
    const service = new MemoryIndexService(source.db, new FakeEmbedder());
    const captured = await capture(service, source);
    expect(service.forget(captured.result.entry.id, 99)).toMatchObject({ reason: "version_conflict" });
    expect(service.forget(captured.result.entry.id, 1)).toEqual({ ok: true });
    expect(service.get(captured.result.entry.id)).toBeNull();
    expect((await service.search("durable memory retrieval")).results).toHaveLength(0);
    const embeddings = source.db.prepare("SELECT COUNT(*) AS count FROM memory_index_embeddings").get() as { count: number };
    expect(embeddings.count).toBe(0);
    await expect(capture(service, source)).rejects.toThrow(/deliberately forgotten/i);
  });
});
