import { describe, expect, it } from "vitest";
import { openInMemoryDb } from "../state/db.js";
import { appendMessage } from "../state/messages.js";
import { createSession } from "../state/sessions.js";
import type { CompleteInput, LLMProvider, StreamEvent, StreamInput } from "../orchestrator/llm/types.js";
import { AutoMemoryCaptureCoordinator } from "./auto-capture.js";
import { MemoryIndexService } from "./store.js";

class MemoryEditorProvider implements LLMProvider {
  readonly name = "openai" as const;
  readonly defaultOrchestratorModel = "fixture-orchestrator";
  readonly defaultSideModel = "fixture-memory-editor";
  readonly prompts: CompleteInput[] = [];
  response = JSON.stringify({
    capture: true,
    title: "Durable research memory",
    summary: "The completed work established a durable, source-verified result that should remain discoverable across future AVA sessions.",
    conclusions: ["SQLite remains authoritative"],
    openQuestions: ["How should linked checkpoints evolve?"],
    nextSteps: ["Test retrieval from another conversation"],
    tags: ["memory", "research"],
    reason: "The result is complete and durable.",
  });
  failure: Error | null = null;

  async *stream(_input: StreamInput): AsyncIterable<StreamEvent> {
    yield { kind: "done", stop_reason: "end_turn" };
  }

  async complete(input: CompleteInput): Promise<string> {
    this.prompts.push(input);
    if (this.failure) throw this.failure;
    return this.response;
  }
}

function completedTurn(userContent: string, assistantContent?: string) {
  const db = openInMemoryDb();
  const session = createSession(db, { title: "Automatic memory fixture" });
  const user = appendMessage(db, { sessionId: session.id, role: "user", content: userContent });
  const assistant = appendMessage(db, {
    sessionId: session.id,
    role: "assistant",
    content: assistantContent ?? "Research completed. The evidence supports a durable source-verified knowledge index. SQLite should remain canonical, embeddings should only locate compact records, and the authoritative conversation range must be checked before AVA relies on the result. This is a sufficiently substantial completed answer for the automatic gate.",
  });
  const provider = new MemoryEditorProvider();
  const coordinator = new AutoMemoryCaptureCoordinator(db, provider, new MemoryIndexService(db, null));
  return { db, session, user, assistant, provider, coordinator };
}

describe("automatic semantic-memory capture", () => {
  it("captures completed research once with verified source and automatic provenance", async () => {
    const fixture = completedTurn("Research durable semantic memory systems and compare the reliable approaches.");

    const first = await fixture.coordinator.consider({
      sessionId: fixture.session.id,
      userMessageId: fixture.user.id,
      assistantMessageId: fixture.assistant.id,
      channel: "chat",
    });
    const replay = await fixture.coordinator.consider({
      sessionId: fixture.session.id,
      userMessageId: fixture.user.id,
      assistantMessageId: fixture.assistant.id,
      channel: "chat",
    });

    expect(first).toMatchObject({ status: "captured", entryId: expect.any(String) });
    expect(replay).toMatchObject({ status: "captured", entryId: first.entryId });
    expect(fixture.provider.prompts).toHaveLength(1);
    const service = new MemoryIndexService(fixture.db, null);
    expect(service.get(first.entryId!)).toMatchObject({
      usable: true,
      entry: {
        kind: "research",
        captureMode: "automatic",
        captureReason: "Automatically indexed completed research from an AVA chat turn.",
      },
      source: { status: "verified", fromMessageId: fixture.user.id, throughMessageId: fixture.assistant.id },
    });
    const events = fixture.db.prepare("SELECT status, candidate_kind, entry_id FROM memory_index_auto_events").all();
    expect(events).toEqual([{ status: "captured", candidate_kind: "research", entry_id: first.entryId }]);
  });

  it("admits only one concurrent editor call for the same completed turn", async () => {
    const fixture = completedTurn("Research idempotent automatic memory capture under concurrent replay.");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const originalComplete = fixture.provider.complete.bind(fixture.provider);
    fixture.provider.complete = async (input) => {
      await gate;
      return originalComplete(input);
    };
    const input = {
      sessionId: fixture.session.id,
      userMessageId: fixture.user.id,
      assistantMessageId: fixture.assistant.id,
      channel: "chat" as const,
    };
    const first = fixture.coordinator.consider(input);
    const replay = fixture.coordinator.consider(input);
    release();
    const [firstResult, replayResult] = await Promise.all([first, replay]);

    expect(firstResult.status).toBe("captured");
    expect(replayResult.status).toBe("in_progress");
    expect(fixture.provider.prompts).toHaveLength(1);
    expect(fixture.db.prepare("SELECT COUNT(*) AS count FROM memory_index_entries").get()).toEqual({ count: 1 });
  });

  it("ignores ordinary conversation without calling the memory editor", async () => {
    const fixture = completedTurn("Hello, how are you today?");
    const result = await fixture.coordinator.consider({
      sessionId: fixture.session.id,
      userMessageId: fixture.user.id,
      assistantMessageId: fixture.assistant.id,
      channel: "chat",
    });
    expect(result.status).toBe("skipped");
    expect(fixture.provider.prompts).toHaveLength(0);
    expect(fixture.db.prepare("SELECT COUNT(*) AS count FROM memory_index_entries").get()).toEqual({ count: 0 });
    expect(fixture.db.prepare("SELECT COUNT(*) AS count FROM memory_index_auto_events").get()).toEqual({ count: 0 });
  });

  it("captures a meaningfully developed multi-turn idea and avoids overlapping checkpoints", async () => {
    const fixture = completedTurn(
      "I have an idea: build a source-linked memory workspace that explains why each result matched.",
      "That idea would make retrieval inspectable. The first design should store compact records, stable source ranges, and a clear match explanation while leaving the transcript authoritative. We should keep privacy controls visible and avoid silent capture of casual conversation.",
    );
    const secondUser = appendMessage(fixture.db, {
      sessionId: fixture.session.id,
      role: "user",
      content: "Agreed. The important refinement is automatic capture only for research and ideas we genuinely develop together, while explicit remember-this remains available for everything else.",
    });
    const secondAssistant = appendMessage(fixture.db, {
      sessionId: fixture.session.id,
      role: "assistant",
      content: "Then the bounded design is clear: a deterministic candidate gate recognizes the eligible category, a conservative memory editor creates a compact summary, SQLite preserves the verified message range, and the interface labels automatic provenance. A later phase can add linked revisions so continued discussion updates rather than duplicates the idea. This gives useful continuity without turning every exchange into durable memory.",
    });
    const result = await fixture.coordinator.consider({
      sessionId: fixture.session.id,
      userMessageId: secondUser.id,
      assistantMessageId: secondAssistant.id,
      channel: "voice",
    });
    expect(result.status).toBe("captured");
    expect(new MemoryIndexService(fixture.db, null).get(result.entryId!)).toMatchObject({
      entry: {
        kind: "idea",
        captureMode: "automatic",
        captureReason: "Automatically indexed a meaningfully developed idea from AVA voice.",
      },
      source: { fromMessageId: fixture.user.id, throughMessageId: secondAssistant.id },
    });

    const thirdUser = appendMessage(fixture.db, { sessionId: fixture.session.id, role: "user", content: "One more idea refinement: group related checkpoints." });
    const thirdAssistant = appendMessage(fixture.db, { sessionId: fixture.session.id, role: "assistant", content: "That belongs in the linked-checkpoint phase. It should connect the new decision to the original idea rather than saving an isolated duplicate. This response is intentionally long enough to pass the basic completion boundary while overlap protection prevents another record in Phase 2." });
    const overlap = await fixture.coordinator.consider({
      sessionId: fixture.session.id,
      userMessageId: thirdUser.id,
      assistantMessageId: thirdAssistant.id,
      channel: "chat",
    });
    expect(overlap).toMatchObject({ status: "skipped", entryId: result.entryId });
    expect(fixture.provider.prompts).toHaveLength(1);
  });

  it("honors a conservative decline and records only content-free status", async () => {
    const fixture = completedTurn("Investigate whether this brief exchange should be remembered.");
    fixture.provider.response = JSON.stringify({
      capture: false, title: "", summary: "", conclusions: [], openQuestions: [], nextSteps: [], tags: [],
      reason: "The exchange did not produce a durable result.",
    });
    const result = await fixture.coordinator.consider({
      sessionId: fixture.session.id,
      userMessageId: fixture.user.id,
      assistantMessageId: fixture.assistant.id,
      channel: "chat",
    });
    expect(result).toMatchObject({ status: "skipped", entryId: null });
    expect(fixture.db.prepare("SELECT status, reason FROM memory_index_auto_events").get()).toEqual({
      status: "skipped", reason: "The exchange did not produce a durable result.",
    });
  });

  it("fails closed when the memory editor fails and leaves the conversation untouched", async () => {
    const fixture = completedTurn("Research a durable failure-isolation policy for automatic memory.");
    fixture.provider.failure = new Error("side model unavailable bearer secret-value");
    const before = fixture.db.prepare("SELECT COUNT(*) AS count FROM messages").get();
    const result = await fixture.coordinator.consider({
      sessionId: fixture.session.id,
      userMessageId: fixture.user.id,
      assistantMessageId: fixture.assistant.id,
      channel: "chat",
    });
    expect(result.status).toBe("failed");
    expect(fixture.db.prepare("SELECT COUNT(*) AS count FROM messages").get()).toEqual(before);
    expect(fixture.db.prepare("SELECT COUNT(*) AS count FROM memory_index_entries").get()).toEqual({ count: 0 });
  });

  it("scrubs secrets before the model and before durable summaries", async () => {
    const secret = "sk-proj-AbCdEf0123456789AbCdEf0123456789";
    const fixture = completedTurn(
      `Research secure memory indexing. A fixture accidentally contains ${secret}.`,
      `The research result is complete and deliberately contains the fixture ${secret}. The durable design must redact secrets before any model-side summarization, retain only a compact discovery record, and verify the underlying source before reuse. This tests both boundaries without retaining the raw credential in the index.`,
    );
    fixture.provider.response = JSON.stringify({
      capture: true,
      title: "Secure automatic memory",
      summary: `This durable summary must scrub ${secret} while retaining the source-verification conclusion and privacy boundary.`,
      conclusions: ["Redact before persistence"], openQuestions: [], nextSteps: [], tags: ["security"], reason: "Durable research.",
    });
    const result = await fixture.coordinator.consider({
      sessionId: fixture.session.id,
      userMessageId: fixture.user.id,
      assistantMessageId: fixture.assistant.id,
      channel: "chat",
    });
    expect(fixture.provider.prompts[0]!.user).not.toContain(secret);
    const stored = JSON.stringify(new MemoryIndexService(fixture.db, null).get(result.entryId!));
    expect(stored).not.toContain(secret);
    expect(stored).toContain("sk-***");
  });
});
