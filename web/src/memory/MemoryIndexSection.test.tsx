// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MemoryIndexResult, MemoryIndexSearchResponse } from "../api.js";

const api = vi.hoisted(() => ({
  fetchMemoryIndex: vi.fn(),
  searchMemoryIndex: vi.fn(),
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
  usable: true,
};

function response(over: Partial<MemoryIndexSearchResponse> = {}): MemoryIndexSearchResponse {
  return {
    query: "",
    project: null,
    mode: "recent",
    semanticAvailable: true,
    notice: null,
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
    expect(screen.getByText(/SQLite is canonical/)).toBeTruthy();
    fireEvent.click(screen.getByText("Why AVA found this"));
    expect(screen.getByText(/semantic similarity 91%/)).toBeTruthy();
    expect(screen.getByText(/messages 10/)).toBeTruthy();
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

    await waitFor(() => expect(api.searchMemoryIndex).toHaveBeenCalledWith({ query: "prior decisions", project: "AVA" }));
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
});
