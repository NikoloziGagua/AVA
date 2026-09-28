import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InitiativeView } from "./api.js";

const api = vi.hoisted(() => ({
  fetchInitiative: vi.fn(),
  markInitiativeOpened: vi.fn(),
  fetchInboxSessions: vi.fn(),
  setInitiativeDisposition: vi.fn(),
}));
vi.mock("./api.js", () => ({
  ...api,
  isInitiativeUnavailable: (error: unknown) => (error as { code?: string })?.code === "initiative_unavailable",
}));

import { useInvitation, type InvitationInput } from "./useInvitation.js";

const NOW = 10_000;

function view(overrides: Partial<InitiativeView> = {}): InitiativeView {
  return {
    id: "ini_2",
    sessionId: "s_2",
    title: "Idea",
    reasonNow: "Because.",
    scope: { kind: "general" },
    publishedAt: 1,
    expiresAt: NOW + 1,
    openedAt: null,
    disposition: { state: "open", version: 1, updatedAt: 1 },
    notification: { state: "accepted" },
    sources: [],
    ...overrides,
  };
}

const INBOX = [
  { id: "s_1", initiativeId: "ini_1", title: "Newest", created_at: 1, updated_at: 1, status: "active", pinned: 0 },
  { id: "s_2", initiativeId: "ini_2", title: "This one", created_at: 1, updated_at: 1, status: "active", pinned: 0 },
  { id: "s_3", initiativeId: "ini_3", title: "Saved for later", created_at: 1, updated_at: 1, status: "active", pinned: 0 },
];

function run(input: Partial<InvitationInput> = {}) {
  return renderHook((props: InvitationInput) => useInvitation(props), {
    initialProps: { sessionId: "s_2", initiativeId: "ini_2", unreplied: true, verify: true, now: () => NOW, ...input },
  });
}

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  api.markInitiativeOpened.mockResolvedValue(undefined);
  api.fetchInboxSessions.mockResolvedValue(INBOX);
});
afterEach(() => { cleanup(); });

describe("useInvitation", () => {
  it("opens a matching idea, marks it seen once, and places it among the pending ones", async () => {
    api.fetchInitiative.mockResolvedValue(view());
    const onChange = vi.fn();
    const { result } = run({ onChange });
    expect(result.current.state.status).toBe("loading");
    await waitFor(() => expect(result.current.state).toMatchObject({
      status: "open",
      position: { index: 2, total: 3, newer: { sessionId: "s_1", initiativeId: "ini_1" }, older: { sessionId: "s_3", initiativeId: "ini_3" } },
    }));
    expect(api.markInitiativeOpened).toHaveBeenCalledWith("ini_2");
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it("does not mark an idea seen twice", async () => {
    api.fetchInitiative.mockResolvedValue(view({ openedAt: 5 }));
    const { result } = run();
    await waitFor(() => expect(result.current.state.status).toBe("open"));
    expect(api.markInitiativeOpened).not.toHaveBeenCalled();
  });

  it("treats a pair that does not match, or a missing idea, as unavailable", async () => {
    api.fetchInitiative.mockResolvedValue(view({ sessionId: "someone_else" }));
    const mismatched = run();
    await waitFor(() => expect(mismatched.result.current.state.status).toBe("unavailable"));
    cleanup();
    api.fetchInitiative.mockRejectedValue({ code: "initiative_unavailable" });
    const missing = run();
    await waitFor(() => expect(missing.result.current.state.status).toBe("unavailable"));
    cleanup();
    const noIdea = run({ initiativeId: null });
    await waitFor(() => expect(noIdea.result.current.state.status).toBe("unavailable"));
    expect(api.markInitiativeOpened).not.toHaveBeenCalled();
  });

  it("stays quiet for a conversation that is not an unanswered idea", async () => {
    const { result } = run({ unreplied: false, verify: false });
    await waitFor(() => expect(result.current.state.status).toBe("none"));
    expect(api.fetchInitiative).not.toHaveBeenCalled();
  });

  it("keeps an expired or dismissed idea readable without answers", async () => {
    api.fetchInitiative.mockResolvedValue(view({ expiresAt: NOW }));
    const expired = run();
    await waitFor(() => expect(expired.result.current.state).toMatchObject({ status: "closed", reason: "expired" }));
    cleanup();
    api.fetchInitiative.mockResolvedValue(view({ disposition: { state: "not_useful", version: 3, updatedAt: 3 } }));
    const dismissed = run();
    await waitFor(() => expect(dismissed.result.current.state).toMatchObject({ status: "closed", reason: "not_useful" }));
  });

  it("saves Later against the version it saw", async () => {
    api.fetchInitiative.mockResolvedValue(view({ openedAt: 5 }));
    api.setInitiativeDisposition.mockResolvedValue({ ok: true, disposition: { state: "later", version: 2, updatedAt: 9 } });
    const onChange = vi.fn();
    const { result } = run({ onChange });
    await waitFor(() => expect(result.current.state.status).toBe("open"));
    await act(async () => { await result.current.later(); });
    expect(api.setInitiativeDisposition).toHaveBeenCalledWith("ini_2", "later", 1);
    expect(result.current.state).toMatchObject({ status: "open", view: { disposition: { state: "later", version: 2 } } });
    expect(result.current.notice).toBe("Saved for later. It stays in your ideas for up to three days.");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("dismisses on Not useful, and shows the latest state when it changed elsewhere", async () => {
    api.fetchInitiative.mockResolvedValue(view({ openedAt: 5 }));
    api.setInitiativeDisposition.mockResolvedValueOnce({ ok: false, current: { state: "later", version: 2 } });
    const { result } = run();
    await waitFor(() => expect(result.current.state.status).toBe("open"));
    await act(async () => { await result.current.notUseful(); });
    expect(result.current.notice).toBe("This idea changed on another device. Here is where it stands now.");
    await waitFor(() => expect(api.fetchInitiative).toHaveBeenCalledTimes(2));

    api.setInitiativeDisposition.mockResolvedValueOnce({ ok: true, disposition: { state: "not_useful", version: 3, updatedAt: 9 } });
    await waitFor(() => expect(result.current.state.status).toBe("open"));
    await act(async () => { await result.current.notUseful(); });
    expect(result.current.state).toMatchObject({ status: "closed", reason: "not_useful" });
  });
});
