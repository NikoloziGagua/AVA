import { describe, it, expect, vi } from "vitest";
import { autoTitle } from "./auto-title.js";

describe("autoTitle", () => {
  it("uses the model response when the API returns text", async () => {
    const fake = {
      messages: {
        create: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "Refactor login flow" }] }),
      },
    };
    const t = await autoTitle({ client: fake as never, firstMessage: "I need to refactor the login code" });
    expect(t).toBe("Refactor login flow");
  });

  it("trims and truncates a model response longer than 60 chars", async () => {
    const fake = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: " A very long title that exceeds the cap for sure and keeps going forever " }],
        }),
      },
    };
    const t = await autoTitle({ client: fake as never, firstMessage: "x" });
    expect(t.length).toBeLessThanOrEqual(60);
    expect(t).not.toMatch(/^\s|\s$/);
  });

  it("falls back to truncation on API error", async () => {
    const fake = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error("rate limited")),
      },
    };
    const t = await autoTitle({
      client: fake as never,
      firstMessage: "list the contents of my Downloads folder, please, please",
    });
    expect(t).toBe("list the contents of my Downloads folder, please, please".slice(0, 60));
  });

  it("falls back to truncation when the API returns no text block", async () => {
    const fake = { messages: { create: vi.fn().mockResolvedValue({ content: [] }) } };
    const t = await autoTitle({ client: fake as never, firstMessage: "hello world" });
    expect(t).toBe("hello world");
  });
});
