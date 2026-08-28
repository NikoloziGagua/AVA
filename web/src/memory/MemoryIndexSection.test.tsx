// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { MemoryIndexResult, MemoryIndexSearchResponse } from "../api.js";

const api = vi.hoisted(() => ({
  fetchMemoryIndex: vi.fn(),
  searchMemoryIndex: vi.fn(),
  correctMemoryIndexEntry: vi.fn(),
  pinMemoryIndexThread: vi.fn(),
  supersedeMemoryIndexThread: vi.fn(),
  setMemoryIndexConflict: vi.fn(),
}));

vi.mock("../api.js", async (loadOriginal) => {
  const original = await loadOriginal<typeof import("../api.js")>();
  return { ...original, ...api };
});

import { MemoryIndexSection } from "./MemoryIndexSection.js";

const result: MemoryIndexResult = {
  entry: {
    id: "memory_fixture",
    version: 1,
    kind: "idea",
    title: "Durable research recall",
    summary: "SQLite is canonical; semantic search only locates verified source material.",
    conclusions: ["Verify before use"],
    openQuestions: ["When should automatic capture begin?"],
    nextSteps: ["Test cross-chat recall"],
    tags: ["memory", "RAG"],
    project: null,
    privacyLevel: "personal",
    captureMode: "automatic",
    captureReason: "Automatically indexed a meaningfully developed idea from AVA chat.",
    threadId: "memory_fixture",
    parentEntryId: "memory_parent",
    checkpointSequence: 2,
    checkpointKind: "decision",
    checkpointReason: "The group chose source verification before retrieval.",
    embeddingStatus: "ready",
    createdAt: Date.UTC(2026, 7, 28),
    updatedAt: Date.UTC(2026, 7, 28),
  },
  originalEntry: {
    id: "memory_fixture",
    version: 1,
    kind: "idea",
    title: "Durable research recall",
    summary: "SQLite is canonical; semantic search only locates verified source material.",
    conclusions: ["Verify before use"],
    openQuestions: ["When should automatic capture begin?"],
    nextSteps: ["Test cross-chat recall"],
    tags: ["memory", "RAG"],
    project: null,
    privacyLevel: "personal",
    captureMode: "automatic",
    captureReason: "Automatically indexed a meaningfully developed idea from AVA chat.",
    threadId: "memory_fixture",
    parentEntryId: "memory_parent",
    checkpointSequence: 2,
    checkpointKind: "decision",
    checkpointReason: "The group chose source verification before retrieval.",
    embeddingStatus: "ready",
    createdAt: Date.UTC(2026, 7, 28),
    updatedAt: Date.UTC(2026, 7, 28),
  },
  source: {
    type: "conversation_range",
    label: "Memory architecture",
    sessionId: "session-source",
    fromMessageId: 10,
    throughMessageId: 14,
    messageCount: 5,
    status: "verified",
    verifiedAt: Date.UTC(2026, 7, 28),
    reason: "The original 5 conversation messages still exist and match the capture fingerprint.",
  },
  match: {
    mode: "hybrid",
    reason: "Matched by semantic similarity 91% plus shared terms: memory. The source is verified separately before use.",
    semanticScore: 0.91,
    lexicalScore: 0.5,
    sharedTerms: ["memory"],
  },
  lineage: {
    threadId: "memory_fixture",
    parentEntryId: "memory_parent",
    sequence: 2,
    kind: "decision",
    reason: "The group chose source verification before retrieval.",
    totalCheckpoints: 2,
    isLatest: true,
  },
  governance: {
    threadVersion: 1,
    pinned: false,
    state: "current",
    retrievalEligible: true,
    corrected: false,
    correctionEventId: null,
    correctionReason: null,
    supersededByThreadId: null,
    conflictWithThreadIds: [],
    updatedAt: Date.UTC(2026, 7, 28),
    events: [],
  },
  usable: true,
};

const otherResult: MemoryIndexResult = {
  ...result,
  entry: { ...result.entry, id: "memory_other", threadId: "memory_other", title: "Replacement recall plan", summary: "The replacement keeps source verification." },
  originalEntry: { ...result.originalEntry, id: "memory_other", threadId: "memory_other", title: "Replacement recall plan", summary: "The replacement keeps source verification." },
  lineage: { ...result.lineage, threadId: "memory_other", parentEntryId: null, sequence: 1, totalCheckpoints: 1 },
};

function response(over: Partial<MemoryIndexSearchResponse> = {}): MemoryIndexSearchResponse {
  return {
    query: "",
    project: null,
    mode: "recent",
    semanticAvailable: true,
    notice: null,
    suppressedByGovernance: 0,
    results: [result],
    ...over,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MemoryIndexSection", () => {
  it("shows a compact source-verified result and explains why it matched", async () => {
    const openChat = vi.fn();
    api.fetchMemoryIndex.mockResolvedValue(response());
    render(<MemoryIndexSection onOpenChat={openChat} />);

    expect(await screen.findByText("Durable research recall")).toBeTruthy();
    expect(screen.getByText("source verified")).toBeTruthy();
    expect(screen.getByText("captured automatically")).toBeTruthy();
    expect(screen.getByText("checkpoint 2 of 2 / latest")).toBeTruthy();
    expect(screen.getByText(/SQLite is canonical/)).toBeTruthy();
    fireEvent.click(screen.getByText("Why AVA found this"));
    expect(screen.getByText(/semantic similarity 91%/)).toBeTruthy();
    expect(screen.getByText(/messages 10/)).toBeTruthy();
    expect(screen.getByText(/meaningfully developed idea from AVA chat/)).toBeTruthy();
    expect(screen.getByText(/follows memory_parent/)).toBeTruthy();
    expect(screen.getByText(/source verification before retrieval/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open source chat" }));
    expect(openChat).toHaveBeenCalledWith("session-source");
  });

  it("sends an explicit project boundary and renders fallback honesty", async () => {
    api.fetchMemoryIndex.mockResolvedValue(response({ results: [] }));
    api.searchMemoryIndex.mockResolvedValue(response({
      query: "prior decisions",
      project: "AVA",
      mode: "lexical",
      semanticAvailable: false,
      notice: "No embedding provider is configured; AVA used exact and keyword matching only.",
      results: [{
        ...result,
        match: {
          mode: "lexical",
          reason: "Matched shared terms: decisions. The source is verified separately before use.",
          semanticScore: null,
          lexicalScore: 0.5,
          sharedTerms: ["decisions"],
        },
      }],
    }));
    render(<MemoryIndexSection />);
    await waitFor(() => expect(api.fetchMemoryIndex).toHaveBeenCalled());
    fireEvent.change(screen.getByPlaceholderText("Ask differently: what did we decide about memory?"), {
      target: { value: "prior decisions" },
    });
    fireEvent.change(screen.getByPlaceholderText("Project (optional)"), { target: { value: "AVA" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(api.searchMemoryIndex).toHaveBeenCalledWith({ query: "prior decisions", project: "AVA", includeHistory: true }));
    expect(await screen.findByText(/No embedding provider is configured/)).toBeTruthy();
    expect(screen.getByText("keyword fallback")).toBeTruthy();
  });

  it("makes changed source evidence visibly unusable", async () => {
    api.fetchMemoryIndex.mockResolvedValue(response({
      results: [{
        ...result,
        usable: false,
        source: {
          ...result.source,
          status: "changed",
          reason: "The referenced conversation range no longer matches its capture fingerprint.",
        },
      }],
    }));
    render(<MemoryIndexSection />);
    expect(await screen.findByText("source changed")).toBeTruthy();
    fireEvent.click(screen.getByText("Why AVA found this"));
    expect(screen.getByText(/no longer matches/i)).toBeTruthy();
  });

  it("appends a correction without hiding the original and refreshes the view", async () => {
    api.fetchMemoryIndex.mockResolvedValue(response());
    api.correctMemoryIndexEntry.mockResolvedValue({ ok: true, result });
    render(<MemoryIndexSection />);
    await screen.findByText("Durable research recall");

    fireEvent.click(screen.getByRole("button", { name: "Correct" }));
    fireEvent.change(screen.getByLabelText("Corrected compact summary"), {
      target: { value: "Semantic search locates a source-verified memory checkpoint." },
    });
    fireEvent.change(screen.getByLabelText("Correction reason"), {
      target: { value: "The original wording implied the summary itself was proof." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));

    await waitFor(() => expect(api.correctMemoryIndexEntry).toHaveBeenCalledWith(expect.objectContaining({
      id: "memory_fixture",
      expectedVersion: 1,
      summary: "Semantic search locates a source-verified memory checkpoint.",
      reason: "The original wording implied the summary itself was proof.",
    })));
    await waitFor(() => expect(api.fetchMemoryIndex).toHaveBeenCalledTimes(2));
  });

  it("pins with a version guard and reports stale governance failures", async () => {
    api.fetchMemoryIndex.mockResolvedValue(response());
    api.pinMemoryIndexThread.mockRejectedValue(new Error("stale_version"));
    render(<MemoryIndexSection />);
    await screen.findByText("Durable research recall");

    fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    expect((await screen.findByRole("alert")).textContent).toContain("stale_version");
    expect(api.pinMemoryIndexThread).toHaveBeenCalledWith(expect.objectContaining({
      threadId: "memory_fixture",
      expectedVersion: 1,
      pinned: true,
    }));
  });

  it("shows immutable correction history and conservative conflict state", async () => {
    const conflictedOther: MemoryIndexResult = {
      ...otherResult,
      governance: {
        ...otherResult.governance,
        threadVersion: 2,
        state: "conflicted",
        retrievalEligible: false,
        conflictWithThreadIds: ["memory_fixture"],
      },
    };
    api.setMemoryIndexConflict.mockResolvedValue({ ok: true, result });
    api.fetchMemoryIndex.mockResolvedValue(response({
      results: [{
        ...result,
        entry: { ...result.entry, summary: "Corrected compact summary." },
        governance: {
          ...result.governance,
          threadVersion: 3,
          state: "conflicted",
          retrievalEligible: false,
          corrected: true,
          correctionEventId: "gov-correct",
          correctionReason: "Clarify the distinction between retrieval and proof.",
          conflictWithThreadIds: ["memory_other"],
          events: [{
            id: "gov-correct",
            threadId: "memory_fixture",
            entryId: "memory_fixture",
            kind: "corrected",
            actor: "user",
            reason: "Clarify the distinction between retrieval and proof.",
            targetThreadId: null,
            resultingVersion: 2,
            createdAt: Date.UTC(2026, 7, 28, 1),
          }],
        },
      }, conflictedOther],
    }));
    render(<MemoryIndexSection />);
    expect(await screen.findAllByText("conflicted")).toHaveLength(2);
    const card = screen.getByText("Durable research recall").closest("article")!;
    expect(within(card).getByText(/Automatic recall is paused/)).toBeTruthy();
    fireEvent.click(within(card).getByText("Why AVA found this"));
    expect(within(card).getByText(/Original compact summary:/).textContent).toContain(result.originalEntry.summary);
    expect(within(card).getByText(/corrected by user/)).toBeTruthy();
    expect(within(card).getByText(/not used automatically/)).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: "Keep this; supersede Replacement recall plan" }));
    await waitFor(() => expect(api.setMemoryIndexConflict).toHaveBeenCalledWith(expect.objectContaining({
      mode: "resolve",
      threadId: "memory_fixture",
      expectedVersion: 3,
      otherThreadId: "memory_other",
      otherExpectedVersion: 2,
    })));
  });

  it("requires an exact current replacement and reason before superseding", async () => {
    api.fetchMemoryIndex.mockResolvedValue(response({ results: [result, otherResult] }));
    api.supersedeMemoryIndexThread.mockResolvedValue({ ok: true, result });
    render(<MemoryIndexSection />);
    await screen.findByText("Durable research recall");

    const cards = screen.getAllByTestId("memory-index-result");
    fireEvent.click(within(cards[0]!).getByRole("button", { name: "Mark obsolete" }));
    fireEvent.change(screen.getByLabelText("Replacement memory"), { target: { value: "memory_other" } });
    fireEvent.change(screen.getByLabelText("Governance reason"), { target: { value: "The replacement reflects the current decision." } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm replacement" }));

    await waitFor(() => expect(api.supersedeMemoryIndexThread).toHaveBeenCalledWith(expect.objectContaining({
      threadId: "memory_fixture",
      expectedVersion: 1,
      replacementThreadId: "memory_other",
      replacementExpectedVersion: 1,
      reason: "The replacement reflects the current decision.",
    })));
  });
});
