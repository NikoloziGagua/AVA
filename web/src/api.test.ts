// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { api, ApiError, fetchSessions } from "./api.js";
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
