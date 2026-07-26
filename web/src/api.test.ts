// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  api,
  ApiError,
  fetchExplorerLive,
  fetchExplorerTask,
  fetchSessions,
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
