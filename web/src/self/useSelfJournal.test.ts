// @vitest-environment jsdom
// Drives the REAL useSelfJournal hook with a routed fetch mock: response-shape
// tolerance for GET /api/self, the improve() initiator, and the server-wired pause.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("../auth/tokens.js", () => ({ getToken: () => "test-token" }));

import { useSelfJournal } from "./useSelfJournal.js";

type Route = (init?: RequestInit) => { status: number; body: unknown };

function mockFetch(routes: Record<string, Route>) {
  const fn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const route = routes[String(url)];
    if (!route) throw new Error(`unmocked fetch: ${String(url)}`);
    const { status, body } = route(init);
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("useSelfJournal", () => {
  it("parses the new {improvements, paused} response shape", async () => {
    mockFetch({
      "/api/self": () => ({
        status: 200,
        body: { improvements: [{ id: "a", goal: "g", status: "queued" }], paused: true },
      }),
    });
    const { result, unmount } = renderHook(() => useSelfJournal());
    await waitFor(() => expect(result.current.intents).toHaveLength(1));
    expect(result.current.paused).toBe(true);
    unmount();
  });

  it("parses worker availability and sends a version-guarded selector update", async () => {
    const worker = {
      provider: "claude", version: 4, updatedAt: 1,
      options: [
        { provider: "claude", label: "Claude Code", installed: true, configuration: "not_checked", available: true, version: "2.1", reason: null },
        { provider: "codex", label: "Codex", installed: true, configuration: "not_checked", available: true, version: "0.147", reason: null },
      ],
    };
    let selected = worker;
    const fn = mockFetch({
      "/api/self": () => ({ status: 200, body: { intents: [], paused: false, worker: selected } }),
      "/api/self/worker": (init) => {
        expect(JSON.parse(String(init?.body))).toEqual({ provider: "codex", expectedVersion: 4 });
        selected = { ...worker, provider: "codex", version: 5 };
        return { status: 200, body: { worker: selected } };
      },
    });
    const { result, unmount } = renderHook(() => useSelfJournal());
    await waitFor(() => expect(result.current.worker?.version).toBe(4));
    await act(async () => { await result.current.selectWorker("codex"); });
    expect(result.current.worker).toMatchObject({ provider: "codex", version: 5 });
    const call = fn.mock.calls.find(([url]) => String(url) === "/api/self/worker");
    expect((call?.[1] as RequestInit).headers).toMatchObject({ authorization: "Bearer test-token" });
    unmount();
  });

  it("locks the displayed worker version when approving a plan", async () => {
    const worker = {
      provider: "codex", version: 7, updatedAt: 1,
      options: [
        { provider: "claude", label: "Claude Code", installed: true, configuration: "not_checked", available: true, version: "2.1", reason: null },
        { provider: "codex", label: "Codex", installed: true, configuration: "not_checked", available: true, version: "0.147", reason: null },
      ],
    };
    const fn = mockFetch({
      "/api/self": () => ({
        status: 200,
        body: { intents: [{ id: "plan-1", goal: "g", status: "awaiting_approval" }], paused: false, worker },
      }),
      "/api/self/plan-1/approve": (init) => {
        expect(JSON.parse(String(init?.body))).toEqual({ expectedWorkerVersion: 7 });
        return { status: 200, body: { ok: true, approved: true, worker } };
      },
    });
    const { result, unmount } = renderHook(() => useSelfJournal());
    await waitFor(() => expect(result.current.worker?.provider).toBe("codex"));
    await act(async () => { await result.current.approve("plan-1"); });
    const call = fn.mock.calls.find(([url]) => String(url) === "/api/self/plan-1/approve");
    expect((call?.[1] as RequestInit).headers).toMatchObject({
      authorization: "Bearer test-token",
      "content-type": "application/json",
    });
    unmount();
  });

  it("surfaces stale approval instead of launching a worker different from the display", async () => {
    const worker = {
      provider: "codex", version: 7, updatedAt: 1,
      options: [
        { provider: "codex", label: "Codex", installed: true, configuration: "not_checked", available: true, version: "0.147", reason: null },
      ],
    };
    mockFetch({
      "/api/self": () => ({ status: 200, body: { intents: [], paused: false, worker } }),
      "/api/self/plan-1/approve": () => ({
        status: 409,
        body: { error: "stale_version", worker: { ...worker, provider: "claude", version: 8 } },
      }),
    });
    const { result, unmount } = renderHook(() => useSelfJournal());
    await waitFor(() => expect(result.current.worker?.version).toBe(7));
    await act(async () => { await result.current.approve("plan-1"); });
    expect(result.current.workerError).toMatch(/changed elsewhere/i);
    unmount();
  });

  it("treats a legacy bare-array response as unpaused", async () => {
    mockFetch({
      "/api/self": () => ({ status: 200, body: [{ id: "a", goal: "g", status: "swapped" }] }),
    });
    const { result, unmount } = renderHook(() => useSelfJournal());
    await waitFor(() => expect(result.current.intents).toHaveLength(1));
    expect(result.current.paused).toBe(false);
    unmount();
  });

  it("still reads the legacy {intents} object shape", async () => {
    mockFetch({
      "/api/self": () => ({ status: 200, body: { intents: [{ id: "a", goal: "g", status: "failed" }] } }),
    });
    const { result, unmount } = renderHook(() => useSelfJournal());
    await waitFor(() => expect(result.current.intents).toHaveLength(1));
    expect(result.current.paused).toBe(false);
    unmount();
  });

  it("improve POSTs the trimmed goal with auth + json headers and reports ok", async () => {
    const fn = mockFetch({
      "/api/self": () => ({ status: 200, body: { improvements: [], paused: false } }),
      "/api/self/improve": () => ({ status: 200, body: { id: "new" } }),
    });
    const { result, unmount } = renderHook(() => useSelfJournal());
    await waitFor(() => expect(fn).toHaveBeenCalled());

    let out: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      out = await result.current.improve("  be kinder  ");
    });
    expect(out).toEqual({ ok: true });

    const call = fn.mock.calls.find(([u]) => String(u) === "/api/self/improve");
    expect(call).toBeTruthy();
    const init = call![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ goal: "be kinder" }));
    expect(init.headers).toMatchObject({
      authorization: "Bearer test-token",
      "content-type": "application/json",
    });
    unmount();
  });

  it("improve surfaces HTTP 409 as a paused error", async () => {
    mockFetch({
      "/api/self": () => ({ status: 200, body: { improvements: [], paused: true } }),
      "/api/self/improve": () => ({ status: 409, body: { error: "paused" } }),
    });
    const { result, unmount } = renderHook(() => useSelfJournal());

    let out: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      out = await result.current.improve("do a thing");
    });
    expect(out!.ok).toBe(false);
    expect(out!.error).toMatch(/paused/i);
    unmount();
  });

  it("improve reports an unavailable selected worker honestly", async () => {
    mockFetch({
      "/api/self": () => ({ status: 200, body: { improvements: [], paused: false } }),
      "/api/self/improve": () => ({ status: 409, body: { error: "worker_unavailable", reason: "Codex CLI is missing" } }),
    });
    const { result, unmount } = renderHook(() => useSelfJournal());
    let out: { ok: boolean; error?: string } | undefined;
    await act(async () => { out = await result.current.improve("do a thing"); });
    expect(out).toEqual({ ok: false, error: "Codex CLI is missing" });
    unmount();
  });

  it("setPaused POSTs /api/self/pause and follows the server's answer", async () => {
    let serverPaused = false;
    const fn = mockFetch({
      "/api/self": () => ({ status: 200, body: { improvements: [], paused: serverPaused } }),
      "/api/self/pause": (init) => {
        serverPaused = (JSON.parse(String(init?.body)) as { paused: boolean }).paused;
        return { status: 200, body: { paused: serverPaused } };
      },
    });
    const { result, unmount } = renderHook(() => useSelfJournal());
    await waitFor(() => expect(fn).toHaveBeenCalled());

    await act(async () => {
      await result.current.setPaused(true);
    });
    expect(result.current.paused).toBe(true);

    const call = fn.mock.calls.find(([u]) => String(u) === "/api/self/pause");
    expect(call).toBeTruthy();
    const init = call![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ paused: true }));
    unmount();
  });
});
