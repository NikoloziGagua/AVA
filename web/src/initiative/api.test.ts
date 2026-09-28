import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api.js";
import {
  fetchInboxSessions,
  fetchInitiative,
  fetchInitiativeSettings,
  fetchInitiativeSummary,
  isInitiativeLinkId,
  isInitiativeUnavailable,
  markInitiativeOpened,
  patchInitiativeSettings,
  setInitiativeDisposition,
} from "./api.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function respond(...replies: Array<[number, unknown]>) {
  const mock = vi.fn();
  for (const [status, body] of replies) {
    mock.mockResolvedValueOnce(new Response(body === undefined ? null : JSON.stringify(body), { status }));
  }
  globalThis.fetch = mock as unknown as typeof fetch;
  return mock;
}

const VIEW = {
  id: "ini_1",
  sessionId: "s_1",
  title: "Pricing test as proof",
  reasonNow: "New landing page ideas yesterday.",
  scope: { kind: "project", folderId: "f_acme", name: "Acme" },
  publishedAt: 1_000,
  expiresAt: 2_000,
  openedAt: null,
  disposition: { state: "open", version: 1, updatedAt: 1_000 },
  notification: { state: "accepted" },
  sources: [
    { type: "note", id: "n_1", title: "Landing page ideas", available: true },
    { type: "note", id: "n_2", title: "Should not leak", available: false },
    { type: "calendar_occurrence", occurrenceKey: "e_1:2026-09-29", title: "Investor call", startsAt: 5_000, endsAt: 6_000, available: true },
  ],
};

describe("initiative API", () => {
  it("reads the inbox summary and rejects shapes it cannot trust", async () => {
    respond([200, { pending: 2, unopened: 1, newest: { initiativeId: "ini_2", sessionId: "s_2", title: "Idea", publishedAt: 9 } }]);
    await expect(fetchInitiativeSummary()).resolves.toEqual({
      pending: 2, unopened: 1, newest: { initiativeId: "ini_2", sessionId: "s_2", title: "Idea", publishedAt: 9 },
    });
    respond([200, { pending: 0, unopened: 0, newest: { initiativeId: "ini_2", sessionId: "s_2", title: "Idea", publishedAt: 9 } }]);
    await expect(fetchInitiativeSummary()).resolves.toEqual({ pending: 0, unopened: 0, newest: null });
    respond([200, { pending: 1, unopened: 2, newest: null }]);
    await expect(fetchInitiativeSummary()).rejects.toMatchObject({ code: "invalid_api_response" });
    respond([200, { pending: 1, unopened: 1, newest: { initiativeId: "../x", sessionId: "s", title: "t", publishedAt: 1 } }]);
    await expect(fetchInitiativeSummary()).rejects.toMatchObject({ code: "invalid_api_response" });
  });

  it("reads an idea and never shows a title for a source that is no longer available", async () => {
    const fetchMock = respond([200, VIEW]);
    const view = await fetchInitiative("ini_1");
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/initiatives/ini_1");
    expect(view.scope).toEqual({ kind: "project", folderId: "f_acme", name: "Acme" });
    expect(view.sources).toEqual([
      { type: "note", id: "n_1", title: "Landing page ideas", available: true },
      { type: "note", id: "n_2", title: null, available: false },
      { type: "calendar_occurrence", occurrenceKey: "e_1:2026-09-29", title: "Investor call", startsAt: 5_000, endsAt: 6_000, available: true },
    ]);
  });

  it("turns any missing idea into one unavailable answer that names nothing", async () => {
    for (const body of [{ error: "initiative_unavailable" }, { error: "api_route_not_found" }]) {
      respond([404, body]);
      const error = await fetchInitiative("ini_1").catch((failure: unknown) => failure);
      expect(isInitiativeUnavailable(error)).toBe(true);
      expect((error as ApiError).message).toBe("This idea is no longer available.");
    }
    respond([500, { error: "boom" }]);
    expect(isInitiativeUnavailable(await fetchInitiative("ini_1").catch((failure: unknown) => failure))).toBe(false);
  });

  it("marks an idea opened", async () => {
    const fetchMock = respond([204, undefined]);
    await markInitiativeOpened("ini_1");
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/initiatives/ini_1/opened");
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe("POST");
  });

  it("answers with the version it saw, and reports what changed elsewhere", async () => {
    const fetchMock = respond([200, { disposition: { state: "later", version: 2, updatedAt: 3 } }]);
    await expect(setInitiativeDisposition("ini_1", "later", 1)).resolves.toEqual({
      ok: true, disposition: { state: "later", version: 2, updatedAt: 3 },
    });
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))).toEqual({ state: "later", expectedVersion: 1 });

    respond([409, { error: "stale_version", disposition: { state: "not_useful", version: 4 } }]);
    await expect(setInitiativeDisposition("ini_1", "later", 1)).resolves.toEqual({
      ok: false, current: { state: "not_useful", version: 4 },
    });
  });

  it("saves settings against their version", async () => {
    const settings = { enabled: false, deliveryLocalTime: "11:00", quietStart: "22:30", quietEnd: "08:30", activeProjectFolderIds: [], version: 3 };
    respond([200, settings]);
    await expect(fetchInitiativeSettings()).resolves.toEqual(settings);

    const fetchMock = respond([200, { ...settings, enabled: true, version: 4 }]);
    await expect(patchInitiativeSettings({ enabled: true }, 3)).resolves.toEqual({ ok: true, settings: { ...settings, enabled: true, version: 4 } });
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))).toEqual({ enabled: true, version: 3 });

    respond([409, { error: "stale_version" }]);
    await expect(patchInitiativeSettings({ enabled: true }, 3)).resolves.toEqual({ ok: false, stale: true });

    respond([200, { ...settings, quietStart: "25:00" }]);
    await expect(fetchInitiativeSettings()).rejects.toMatchObject({ code: "invalid_api_response" });
  });

  it("lists AVA's pending invitations from the inbox scope", async () => {
    const fetchMock = respond([200, { sessions: [{ id: "s_1", initiativeId: "ini_1" }, { id: "bad id" }], nextCursor: null }]);
    await expect(fetchInboxSessions()).resolves.toEqual([{ id: "s_1", initiativeId: "ini_1" }]);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/sessions?scope=inbox&limit=20");
  });

  it("accepts only plain IDs from a link", () => {
    expect(isInitiativeLinkId("ini_a-1")).toBe(true);
    for (const bad of ["", "a/b", "a b", "x".repeat(129), null, 7]) expect(isInitiativeLinkId(bad)).toBe(false);
  });
});
