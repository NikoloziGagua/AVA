// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  api,
  ApiError,
  createWatchApi,
  fetchExplorerLive,
  fetchExplorerTask,
  fetchMissionExport,
  fetchUiPreferences,
  fetchSession,
  fetchSessionPage,
  fetchWatchCommunicationEvidence,
  patchUiPreferences,
  readCachedUiPreferences,
  saveMissionExport,
  transcribeAudio,
  type MissionEvidenceExport,
} from "./api.js";
import { setToken, getToken } from "./auth/tokens.js";

describe("UI preferences API", () => {
  beforeEach(() => {
    localStorage.clear();
    setToken("ui-pref-token");
  });

  it("reads the authenticated authority and mirrors it for first paint/offline use", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      preferences: { look: "paper", motion: "system", faceEnabled: false, version: 4, updatedAt: 44 },
    }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    await expect(fetchUiPreferences()).resolves.toMatchObject({ look: "paper", motion: "system", version: 4 });
    expect(readCachedUiPreferences()).toEqual({
      look: "paper", motion: "system", faceEnabled: false, version: 4, updatedAt: 44,
    });
    expect(localStorage.getItem("ava.ui.look")).toBe("paper");
    expect(localStorage.getItem("ava-motion")).toBe("system");
    const [, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer ui-pref-token");
  });

  it("imports the legacy motion choice once with a guarded PATCH", async () => {
    localStorage.setItem("ava-motion", "reduced");
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        preferences: { look: "ink", motion: "full", faceEnabled: true, version: 1, updatedAt: 1 },
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        preferences: { look: "ink", motion: "reduced", faceEnabled: true, version: 2, updatedAt: 2 },
      }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    await expect(fetchUiPreferences()).resolves.toMatchObject({ motion: "reduced", version: 2 });
    const mock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(mock).toHaveBeenCalledTimes(2);
    const [path, init] = mock.mock.calls[1] as [string, RequestInit];
    expect(path).toBe("/api/ui/preferences");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ expectedVersion: 1, motion: "reduced" });
  });

  it("patches exact fields and keeps the last mirror available after an offline failure", async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        preferences: { look: "ink", motion: "full", faceEnabled: false, version: 2, updatedAt: 20 },
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockRejectedValueOnce(new TypeError("offline")) as unknown as typeof fetch;
    await expect(patchUiPreferences(1, { faceEnabled: false })).resolves.toMatchObject({ version: 2 });
    await expect(fetchUiPreferences()).rejects.toMatchObject({ code: "server_unreachable" });
    expect(readCachedUiPreferences()).toMatchObject({ faceEnabled: false, version: 2 });
    const mock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const [, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ expectedVersion: 1, faceEnabled: false });
  });

  it("ignores a malformed local mirror", () => {
    localStorage.setItem("ava-ui-preferences", JSON.stringify({ look: "paper", version: "fake" }));
    expect(readCachedUiPreferences()).toBeNull();
  });
});

describe("api.deleteSession", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
  });

  it("issues DELETE /api/sessions/:id", async () => {
    await api.deleteSession("abc123");
    const f = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(f).toHaveBeenCalledWith(
      "/api/sessions/abc123",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});

describe("api 401 recovery", () => {
  beforeEach(() => {
    setToken("stale-token");
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }) as unknown as typeof fetch;
  });

  it("clears the token, dispatches ava:unauthorized, and throws ApiError(401)", async () => {
    const seen = vi.fn();
    window.addEventListener("ava:unauthorized", seen);
    try {
      await expect(fetchSessionPage({ scope: "human" })).rejects.toBeInstanceOf(ApiError);
      // Token cleared so the shell can return to pairing.
      expect(getToken()).toBeNull();
      // Cross-agent contract: App.tsx listens for exactly this event.
      expect(seen).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("ava:unauthorized", seen);
    }
  });
});

describe("exact conversation lookup", () => {
  it("normalizes any 404 to the typed session_unavailable error", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "not_found" }), { status: 404 })) as unknown as typeof fetch;
    const failure = await fetchSession("gone/1").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(404);
    expect((failure as ApiError).code).toBe("session_unavailable");
    const [path] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(path).toBe("/api/sessions/gone%2F1");
  });

  it("leaves other failures untouched", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ error: "boom" }), { status: 500 })) as unknown as typeof fetch;
    const failure = await fetchSession("s1").catch((error: unknown) => error);
    expect((failure as ApiError).status).toBe(500);
    expect((failure as ApiError).code).toBe("boom");
  });
});

describe("exact voice text API", () => {
  it("preserves exact characters and sends the bounded voice provenance marker", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ sessionId: "shared-session" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
    const exact = "  @_princi150/path?q=A_B%20C\nCode();  ";
    await api.sendMessage("shared-session", exact, { voice: true, inputSource: "voice_exact_text" });
    const [, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      sessionId: "shared-session",
      text: exact,
      voice: true,
      inputSource: "voice_exact_text",
    });
  });
});

describe("composer dictation API", () => {
  it("uploads authenticated multipart audio without forcing a JSON content type", async () => {
    setToken("dictation-token");
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ text: "exact spoken words" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

    await expect(transcribeAudio(new Blob(["audio"], { type: "audio/webm" })))
      .resolves.toBe("exact spoken words");

    const mock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const [path, init] = mock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(path).toBe("/api/transcribe");
    expect(init.method).toBe("POST");
    expect(headers.get("authorization")).toBe("Bearer dictation-token");
    expect(headers.has("content-type")).toBe(false);
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("rejects an empty transcription instead of inserting fake draft text", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ text: "   " }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
    await expect(transcribeAudio(new Blob(["audio"], { type: "audio/webm" })))
      .rejects.toMatchObject({ code: "empty_transcription" });
  });
});

describe("watch management API", () => {
  it("maps the typed form contract to the existing authenticated watch route", async () => {
    setToken("watch-token");
    const watch = { id: "watch-new", prompt: "Watch status", interval_minutes: 30 };
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ watch }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

    await expect(createWatchApi({
      prompt: "Watch status",
      intervalMinutes: 30,
      once: true,
      kind: "check",
    })).resolves.toMatchObject({ id: "watch-new" });

    const [path, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/watches");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer watch-token");
    expect(JSON.parse(String(init.body))).toEqual({
      prompt: "Watch status",
      interval_minutes: 30,
      once: true,
      kind: "check",
    });
  });

  it("revalidates one authenticated receipt and collapses malformed evidence client-side", async () => {
    setToken("watch-receipt-token");
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        communication_evidence: {
          availability: "available",
          runId: "communication:codex_watcher:watch-exact-one",
        },
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        communication_evidence: {
          availability: "available",
          runId: "communication:codex_watcher:other-watch",
        },
      }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

    await expect(fetchWatchCommunicationEvidence("watch-exact-one")).resolves.toEqual({
      availability: "available",
      runId: "communication:codex_watcher:watch-exact-one",
    });
    const [path, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/watches/watch-exact-one/communication-evidence");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer watch-receipt-token");
    await expect(fetchWatchCommunicationEvidence("watch-exact-one"))
      .resolves.toEqual({ availability: "unavailable" });
  });
});

describe("Mission Control export API", () => {
  it("requests the selected authenticated scope without placing the token in the URL", async () => {
    setToken("paired-export-token");
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      service: "ava-mission-control",
      format: "json",
      exportSchemaVersion: 1,
      scope: { type: "trace", anchorRunId: "run:one", traceId: "trace-one" },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

    const result = await fetchMissionExport("run:one", "trace");
    const mock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const [path, init] = mock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/mission-control/runs/run%3Aone/export?scope=trace&format=json");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer paired-export-token");
    expect(path).not.toContain("paired-export-token");
    expect(result).toMatchObject({ exportSchemaVersion: 1, scope: { type: "trace" } });
  });

  it("creates and revokes a local JSON download without server-side persistence", () => {
    const createObjectURL = vi.fn(() => "blob:mission-export");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(globalThis.URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(globalThis.URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const evidence = {
      generatedAt: Date.UTC(2026, 7, 11, 12, 30, 0),
      scope: { type: "run", anchorRunId: "run:unsafe/name", traceId: "trace-one" },
      service: "ava-mission-control",
      format: "json",
    } as unknown as MissionEvidenceExport;

    saveMissionExport(evidence);

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mission-export");
    click.mockRestore();
  });
});

describe("api actionable failures", () => {
  it("identifies an HTML Explorer 404 as a stale server/frontend deployment", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("<!DOCTYPE html><p>Cannot GET /api/explorer/live</p>", {
        status: 404,
        headers: { "content-type": "text/html" },
      })) as unknown as typeof fetch;

    try {
      await fetchExplorerLive();
      throw new Error("expected Explorer request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({
        status: 404,
        code: "explorer_api_unavailable",
        path: "/api/explorer/live",
      });
      expect((error as ApiError).message).toContain("interface and server builds do not match");
      expect((error as ApiError).action).toContain("restart");
    }
  });

  it("preserves actionable JSON errors for a genuinely missing task record", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        error: "explorer_task_not_found",
        message: "No instrumented Explorer task exists for this ID.",
        action: "Choose a task from the recorded task list.",
        retryable: false,
      }), {
        status: 404,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;

    try {
      await fetchExplorerTask("old-task");
      throw new Error("expected task request to fail");
    } catch (error) {
      expect(error).toMatchObject({
        status: 404,
        code: "explorer_task_not_found",
        action: "Choose a task from the recorded task list.",
      });
      expect((error as ApiError).message).toContain("No instrumented Explorer task");
    }
  });

  it("reports a stopped AVA server instead of exposing a generic fetch failure", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;

    try {
      await fetchExplorerLive();
      throw new Error("expected network request to fail");
    } catch (error) {
      expect(error).toMatchObject({
        status: 0,
        code: "server_unreachable",
        path: "/api/explorer/live",
      });
      expect((error as ApiError).message).toContain("Start or restart");
    }
  });
});
