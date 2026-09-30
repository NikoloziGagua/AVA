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
    relationship: "continue",
    checkpointKind: "revision",
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

  it("captures a developed idea and appends a source-verified linked refinement", async () => {
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
    const thirdAssistant = appendMessage(fixture.db, { sessionId: fixture.session.id, role: "assistant", content: "That becomes a linked checkpoint. It connects the new decision to the original idea rather than rewriting or saving an isolated duplicate. The current snapshot should keep SQLite and verified sources as the foundation while adding one ordered, inspectable checkpoint chain with a plain-language change reason." });
    fixture.provider.response = JSON.stringify({
      capture: true,
      title: "Source-linked memory workspace",
      summary: "The current design keeps SQLite and verified source ranges authoritative, and now preserves material refinements as an ordered immutable checkpoint chain rather than overwriting earlier conclusions.",
      conclusions: ["Related checkpoints share one thread"],
      openQuestions: ["When should a topic shift start a new thread?"],
      nextSteps: ["Expose checkpoint lineage in the Memory Index"],
      tags: ["memory", "lineage"],
      reason: "The discussion added immutable linked checkpoint history.",
      relationship: "continue",
      checkpointKind: "decision",
    });
    const refinement = await fixture.coordinator.consider({
      sessionId: fixture.session.id,
      userMessageId: thirdUser.id,
      assistantMessageId: thirdAssistant.id,
      channel: "chat",
    });
    expect(refinement).toMatchObject({ status: "captured", entryId: expect.any(String) });
    expect(refinement.entryId).not.toBe(result.entryId);
    const linked = new MemoryIndexService(fixture.db, null).get(refinement.entryId!);
    expect(linked).toMatchObject({
      entry: {
        parentEntryId: result.entryId,
        threadId: result.entryId,
        checkpointSequence: 2,
        checkpointKind: "decision",
      },
      lineage: { totalCheckpoints: 2, isLatest: true },
      source: { fromMessageId: fixture.user.id, throughMessageId: thirdAssistant.id },
    });
    expect(new MemoryIndexService(fixture.db, null).get(result.entryId!)).toMatchObject({
      lineage: { totalCheckpoints: 2, isLatest: false },
    });
    expect(fixture.provider.prompts).toHaveLength(2);
    expect(fixture.provider.prompts[1]!.user).toContain("Previous verified compact checkpoint");
  });

  it("does not call the editor or append a checkpoint for superficial continuation", async () => {
    const fixture = completedTurn(
      "I have an idea for an inspectable project memory compass.",
      "The compass can connect decisions to evidence, uncertainty, and next actions. It should use stable links, preserve source provenance, and remain compact enough to navigate. A first version can focus on a private project and show why each relationship exists without copying the entire conversation into memory.",
    );
    const secondUser = appendMessage(fixture.db, { sessionId: fixture.session.id, role: "user", content: "Develop the workflow and tradeoffs for this idea in detail." });
    const secondAssistant = appendMessage(fixture.db, { sessionId: fixture.session.id, role: "assistant", content: "The workflow begins with one decision, attaches bounded evidence, records unresolved uncertainty, and proposes a next action. It favors inspectable provenance over invisible personalization. The core tradeoff is useful continuity versus excessive capture, so only meaningfully developed material becomes durable and the user can inspect its source." });
    const initial = await fixture.coordinator.consider({ sessionId: fixture.session.id, userMessageId: secondUser.id, assistantMessageId: secondAssistant.id, channel: "chat" });
    const thanks = appendMessage(fixture.db, { sessionId: fixture.session.id, role: "user", content: "Thanks, that is helpful." });
    const reply = appendMessage(fixture.db, { sessionId: fixture.session.id, role: "assistant", content: "You're welcome. The idea is available when you want to continue it, and no additional durable checkpoint is needed because this turn did not change the design, conclusions, questions, or next actions in any meaningful way." });
    const skipped = await fixture.coordinator.consider({ sessionId: fixture.session.id, userMessageId: thanks.id, assistantMessageId: reply.id, channel: "chat" });

    expect(initial.status).toBe("captured");
    expect(skipped.status).toBe("skipped");
    expect(fixture.provider.prompts).toHaveLength(1);
    expect(fixture.db.prepare("SELECT COUNT(*) AS count FROM memory_index_entries").get()).toEqual({ count: 1 });
  });

  it("keeps a distinct developed topic as a separate thread instead of attaching it to the prior idea", async () => {
    const fixture = completedTurn(
      "I have an idea for a private evidence compass.",
      "The evidence compass connects decisions, sources, uncertainty, and next actions in one inspectable workspace. Its first version should be intentionally small, preserve provenance, and avoid copying entire conversations. This establishes enough substance for a later refinement and a durable initial checkpoint.",
    );
    const initialUser = appendMessage(fixture.db, { sessionId: fixture.session.id, role: "user", content: "Develop this idea into a detailed workflow and identify the main tradeoff." });
    const initialAssistant = appendMessage(fixture.db, { sessionId: fixture.session.id, role: "assistant", content: "A user records one decision, attaches evidence, marks uncertainty, and chooses a next action. AVA preserves the source range and explains retrieval. The main tradeoff is continuity versus over-capture, so automatic persistence should require meaningful development and remain inspectable and reversible." });
    const initial = await fixture.coordinator.consider({ sessionId: fixture.session.id, userMessageId: initialUser.id, assistantMessageId: initialAssistant.id, channel: "chat" });

    appendMessage(fixture.db, { sessionId: fixture.session.id, role: "user", content: "I also have a separate idea: a local accessibility rehearsal studio that checks keyboard paths, reduced motion, narrow widths, and screen-reader labels before a UI release." });
    appendMessage(fixture.db, { sessionId: fixture.session.id, role: "assistant", content: "That is distinct from the memory compass. The studio could load deterministic fixtures, replay each accessibility mode, collect observable failures, and produce a compact release receipt. It should not claim a screen-reader outcome from DOM checks alone, and it should keep screenshots optional and sanitized." });
    const finalUser = appendMessage(fixture.db, { sessionId: fixture.session.id, role: "user", content: "Refine this new direction into a separate product workflow, with a decision about its first supported checks and the next validation step." });
    const finalAssistant = appendMessage(fixture.db, { sessionId: fixture.session.id, role: "assistant", content: "The separate studio workflow starts with a chosen component fixture, runs keyboard navigation, reduced-motion, narrow-width, and label checks, then records verified observations and honest gaps. The first decision is to support deterministic browser checks without pretending they replace assistive-technology testing. The next step is a bounded fixture harness and an accessible result receipt." });
    fixture.provider.response = JSON.stringify({
      capture: true,
      title: "Accessibility rehearsal studio",
      summary: "A separate local studio rehearses keyboard, reduced-motion, narrow-width, and accessible-label behavior against deterministic fixtures, then produces an honest release receipt without overstating browser checks.",
      conclusions: ["Start with deterministic browser accessibility checks"],
      openQuestions: ["When should real assistive-technology sessions be added?"],
      nextSteps: ["Build one bounded fixture harness"],
      tags: ["accessibility", "testing"],
      reason: "The later discussion developed a distinct product idea.",
      relationship: "new_thread",
      checkpointKind: "initial",
    });
    const separate = await fixture.coordinator.consider({ sessionId: fixture.session.id, userMessageId: finalUser.id, assistantMessageId: finalAssistant.id, channel: "chat" });
    const result = new MemoryIndexService(fixture.db, null).get(separate.entryId!);

    expect(initial.status).toBe("captured");
    expect(separate.status).toBe("captured");
    expect(result).toMatchObject({
      entry: { parentEntryId: null, checkpointSequence: 1, checkpointKind: "initial" },
      lineage: { totalCheckpoints: 1, isLatest: true },
    });
    expect(result!.entry.threadId).toBe(result!.entry.id);
    expect(result!.entry.threadId).not.toBe(initial.entryId);
  });

  it("prevents concurrent later turns from forking or rewriting terminal checkpoint history", async () => {
    const fixture = completedTurn(
      "I have an idea for immutable source-linked checkpoints.",
      "The design should preserve each material change, connect it to the prior compact state, and keep the conversation range authoritative. This initial concept is detailed enough to develop into a workflow with decisions and next steps without replacing earlier history. Each checkpoint should explain why it exists, retain bounded source evidence, and remain useful across chat, voice, restart, and later semantic retrieval.",
    );
    const initialUser = appendMessage(fixture.db, { sessionId: fixture.session.id, role: "user", content: "Develop the idea and decide how checkpoint ordering should work." });
    const initialAssistant = appendMessage(fixture.db, { sessionId: fixture.session.id, role: "assistant", content: "Each checkpoint receives one thread ID, a parent ID, and a monotonic sequence. A source fingerprint verifies the expanding authoritative range. The key decision is append-only history: later summaries may describe current state, but earlier conclusions are never rewritten. Retrieval can show the latest compact state while preserving older checkpoints for inspection, and privacy controls remain identical at every link." });
    const initial = await fixture.coordinator.consider({ sessionId: fixture.session.id, userMessageId: initialUser.id, assistantMessageId: initialAssistant.id, channel: "chat" });

    const firstUser = appendMessage(fixture.db, { sessionId: fixture.session.id, role: "user", content: "Decision FIRST: add a stable parent-version guard before appending a checkpoint." });
    const firstAssistant = appendMessage(fixture.db, { sessionId: fixture.session.id, role: "assistant", content: "The first concurrent refinement adds a parent-version guard. It ensures an append cannot attach to a stale parent after another turn wins the race. The checkpoint still uses the complete verified source range and never mutates the terminal projection of an earlier entry." });
    const secondUser = appendMessage(fixture.db, { sessionId: fixture.session.id, role: "user", content: "Next step SECOND: make a later, broader checkpoint subsume an older completion that arrives late." });
    const secondAssistant = appendMessage(fixture.db, { sessionId: fixture.session.id, role: "assistant", content: "The second concurrent refinement covers both pending changes in a broader authoritative range. If it completes first, an older late completion is recorded as skipped and points to the broader checkpoint. This prevents forks, duplicate sequence numbers, and terminal history rewrites." });

    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    fixture.provider.complete = async (input) => {
      fixture.provider.prompts.push(input);
      if (input.user.includes(`Authoritative range: ${firstUser.id}-${firstAssistant.id}`)) await firstGate;
      return JSON.stringify({
        capture: true,
        title: "Immutable source-linked checkpoints",
        summary: "The design uses stable parent-version guards and lets a broader later source range subsume an older late completion, preserving one append-only checkpoint chain without forks.",
        conclusions: ["Checkpoint history is append-only"],
        openQuestions: [],
        nextSteps: ["Test concurrent completion order"],
        tags: ["memory", "concurrency"],
        reason: "Concurrency ordering became an explicit design decision.",
        relationship: "continue",
        checkpointKind: "decision",
      });
    };
    const older = fixture.coordinator.consider({ sessionId: fixture.session.id, userMessageId: firstUser.id, assistantMessageId: firstAssistant.id, channel: "chat" });
    const broader = await fixture.coordinator.consider({ sessionId: fixture.session.id, userMessageId: secondUser.id, assistantMessageId: secondAssistant.id, channel: "voice" });
    releaseFirst();
    const late = await older;

    expect(initial.status).toBe("captured");
    expect(broader.status).toBe("captured");
    expect(late).toMatchObject({ status: "skipped", entryId: broader.entryId });
    expect(fixture.db.prepare("SELECT COUNT(*) AS count FROM memory_index_entries").get()).toEqual({ count: 2 });
    expect(new MemoryIndexService(fixture.db, null).get(broader.entryId!)).toMatchObject({
      entry: { checkpointSequence: 2, parentEntryId: initial.entryId },
      source: { throughMessageId: secondAssistant.id },
      lineage: { totalCheckpoints: 2, isLatest: true },
    });
  });

  it("honors a conservative decline and records only content-free status", async () => {
    const fixture = completedTurn("Investigate whether this brief exchange should be remembered.");
    fixture.provider.response = JSON.stringify({
      capture: false, title: "", summary: "", conclusions: [], openQuestions: [], nextSteps: [], tags: [],
      reason: "The exchange did not produce a durable result.",
      relationship: "continue", checkpointKind: "revision",
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
      relationship: "continue", checkpointKind: "revision",
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
