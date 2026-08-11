// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  api,
  ApiError,
  fetchExplorerLive,
  fetchExplorerTask,
  fetchMissionExport,
  fetchSessions,
  saveMissionExport,
  type MissionEvidenceExport,
} from "./api.js";
import { setToken, getToken } from "./auth/tokens.js";

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
      await expect(fetchSessions()).rejects.toBeInstanceOf(ApiError);
      // Token cleared so the shell can return to pairing.
      expect(getToken()).toBeNull();
      // Cross-agent contract: App.tsx listens for exactly this event.
      expect(seen).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("ava:unauthorized", seen);
    }
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
