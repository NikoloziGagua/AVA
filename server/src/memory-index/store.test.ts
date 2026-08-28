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

describe("semantic memory index", () => {
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
