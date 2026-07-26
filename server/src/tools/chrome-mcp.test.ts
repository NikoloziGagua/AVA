import { describe, it, expect, vi } from "vitest";
import { buildChromeTools } from "./chrome-mcp.js";
import type { Chrome } from "./chrome.js";

function fakeChrome(): Chrome {
  return {
    open: vi.fn(async () => ({ ok: true, title: "Example" })),
    navigate: vi.fn(async () => ({ ok: true, title: "Example" })),
  } as unknown as Chrome;
}

describe("buildChromeTools (lazy chrome)", () => {
  it("does not boot chrome at construction time", () => {
    const getChrome = vi.fn(async () => fakeChrome());
    buildChromeTools({ getChrome, emit: () => {} });
    // Constructing the tool registry must be free — booting Chromium for a
    // chat turn that never browses is the regression we're killing.
    expect(getChrome).not.toHaveBeenCalled();
  });

  it("boots chrome lazily on first dispatch and forwards the call", async () => {
    const chrome = fakeChrome();
    const getChrome = vi.fn(async () => chrome);
    const tools = buildChromeTools({ getChrome, emit: () => {} });
    const navigate = tools.find((t) => t.tool.name === "chrome_navigate")!;

    const r = await navigate.run({ url: "https://example.com" });

    expect(getChrome).toHaveBeenCalledTimes(1);
    expect((chrome.navigate as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("https://example.com");
    expect(r.ok).toBe(true);
  });

  it("opens the persistent AVA Chrome instead of spawning another profile", async () => {
    const chrome = fakeChrome();
    const tools = buildChromeTools({ getChrome: async () => chrome, emit: () => {} });
    const open = tools.find((t) => t.tool.name === "chrome_open")!;
    const r = await open.run({});
    expect(chrome.open).toHaveBeenCalledWith(undefined);
    expect(r.text).toContain("AVA Chrome is visible");
  });
});
