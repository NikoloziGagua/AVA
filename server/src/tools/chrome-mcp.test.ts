import { describe, it, expect, vi } from "vitest";
import {
  buildChromeTools,
  googleSearchUrl,
  normalizeDirectHttpUrl,
  verifyExactHttpUrl,
  verifyGoogleSearchUrl,
  verifyYouTubeSearchUrl,
  youtubeSearchUrl,
} from "./chrome-mcp.js";
import type { Chrome } from "./chrome.js";

function fakeChrome(): Chrome {
  let currentUrl = "about:blank";
  return {
    open: vi.fn(async (url?: string) => {
      if (url) currentUrl = url;
      return { ok: true, title: "Example" };
    }),
    navigate: vi.fn(async (url: string) => {
      currentUrl = url;
      return { ok: true, title: "Example" };
    }),
    url: vi.fn(() => currentUrl),
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

  it("opens and independently verifies an encoded Google search", async () => {
    const chrome = fakeChrome();
    const tools = buildChromeTools({ getChrome: async () => chrome, emit: () => {} });
    const search = tools.find((t) => t.tool.name === "chrome_google_search")!;
    const r = await search.run({ query: "fish & chips in Tbilisi" });

    expect(chrome.open).toHaveBeenCalledWith(googleSearchUrl("fish & chips in Tbilisi"));
    expect(r.ok).toBe(true);
    expect(r.verification).toMatchObject({
      state: "verified",
      scope: "task_outcome",
      method: "chrome_google_search_url",
    });
    expect(r.text).toContain("direct persistent browser");
  });

  it("opens and independently verifies one explicit HTTP destination", async () => {
    const chrome = fakeChrome();
    const openUrl = buildChromeTools({ getChrome: async () => chrome, emit: () => {} })
      .find((tool) => tool.tool.name === "chrome_open_url")!;

    const result = await openUrl.run({ url: "https://example.com/docs?q=one" });

    expect(chrome.open).toHaveBeenCalledWith("https://example.com/docs?q=one");
    expect(result).toMatchObject({
      ok: true,
      verification: {
        state: "verified",
        scope: "task_outcome",
        method: "chrome_exact_url",
      },
    });
  });

  it("focuses an exact destination without navigating twice and contradicts redirects", async () => {
    const chrome = fakeChrome();
    await chrome.open("https://example.com/");
    (chrome.open as ReturnType<typeof vi.fn>).mockClear();
    const openUrl = buildChromeTools({ getChrome: async () => chrome, emit: () => {} })
      .find((tool) => tool.tool.name === "chrome_open_url")!;

    expect((await openUrl.run({ url: "https://example.com/" })).verification?.state).toBe("verified");
    expect(chrome.open).toHaveBeenCalledWith(undefined);

    chrome.open = vi.fn(async () => ({ ok: true, title: "Redirect" }));
    chrome.url = vi.fn(() => "https://other.example/");
    const redirected = buildChromeTools({ getChrome: async () => chrome, emit: () => {} })
      .find((tool) => tool.tool.name === "chrome_open_url")!;
    const result = await redirected.run({ url: "https://example.com/" });
    expect(result.ok).toBe(false);
    expect(result.verification?.state).toBe("contradicted");
  });

  it("opens and independently verifies an encoded YouTube search", async () => {
    const chrome = fakeChrome();
    const search = buildChromeTools({ getChrome: async () => chrome, emit: () => {} })
      .find((tool) => tool.tool.name === "chrome_youtube_search")!;
    const result = await search.run({ query: "fish & chips documentary" });

    expect(chrome.open).toHaveBeenCalledWith(youtubeSearchUrl("fish & chips documentary"));
    expect(result.verification).toMatchObject({
      state: "verified",
      scope: "task_outcome",
      method: "chrome_youtube_search_url",
    });
  });

  it("focuses without navigating again when the exact search is already open", async () => {
    const chrome = fakeChrome();
    await chrome.open(googleSearchUrl("idempotent route"));
    (chrome.open as ReturnType<typeof vi.fn>).mockClear();
    const search = buildChromeTools({ getChrome: async () => chrome, emit: () => {} })
      .find((t) => t.tool.name === "chrome_google_search")!;

    const r = await search.run({ query: "idempotent route" });

    expect(chrome.open).toHaveBeenCalledWith(undefined);
    expect(r.verification?.state).toBe("verified");
  });

  it("returns contradicted evidence instead of claiming success after a redirect", async () => {
    const chrome = fakeChrome();
    chrome.open = vi.fn(async () => ({ ok: true, title: "Consent" }));
    chrome.url = vi.fn(() => "https://consent.google.com/m");
    const search = buildChromeTools({ getChrome: async () => chrome, emit: () => {} })
      .find((t) => t.tool.name === "chrome_google_search")!;

    const r = await search.run({ query: "redirect test" });

    expect(r.ok).toBe(false);
    expect(r.verification?.state).toBe("contradicted");
    expect(r.text).toContain("verification failed");
  });

  it("does not send credential-shaped search text to Chrome", async () => {
    const chrome = fakeChrome();
    const search = buildChromeTools({ getChrome: async () => chrome, emit: () => {} })
      .find((t) => t.tool.name === "chrome_google_search")!;

    const r = await search.run({ query: "sk-abcdefghijklmnopqrstuvwxyz123456" });

    expect(r.ok).toBe(false);
    expect(chrome.open).not.toHaveBeenCalled();
    expect(r.text).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
  });

  it("blocks non-http, credential-bearing, and secret-bearing direct URLs", async () => {
    const chrome = fakeChrome();
    const openUrl = buildChromeTools({ getChrome: async () => chrome, emit: () => {} })
      .find((tool) => tool.tool.name === "chrome_open_url")!;

    expect((await openUrl.run({ url: "file:///C:/private.txt" })).ok).toBe(false);
    expect((await openUrl.run({ url: "https://user:pass@example.com/" })).ok).toBe(false);
    const secret = await openUrl.run({ url: "https://example.com/?token=sk-abcdefghijklmnopqrstuvwxyz123456" });
    expect(secret.ok).toBe(false);
    expect(secret.text).not.toContain("sk-abcdefghijklmnopqrstuvwxyz123456");
    expect(chrome.open).not.toHaveBeenCalled();
  });
});

describe("verifyGoogleSearchUrl", () => {
  it("requires a supported Google host, search path, and exact query", () => {
    expect(verifyGoogleSearchUrl("https://www.google.com/search?q=AVA", "AVA").verified).toBe(true);
    expect(verifyGoogleSearchUrl("https://www.google.co.uk/search?q=AVA", "AVA").verified).toBe(true);
    expect(verifyGoogleSearchUrl("https://google.com.evil.test/search?q=AVA", "AVA").verified).toBe(false);
    expect(verifyGoogleSearchUrl("https://www.google.com/search?q=other", "AVA").verified).toBe(false);
    expect(verifyGoogleSearchUrl("not a URL", "AVA").verified).toBe(false);
  });
});

describe("direct browser URL verification", () => {
  it("normalizes and compares exact HTTP(S) destinations", () => {
    expect(normalizeDirectHttpUrl("https://example.com")).toEqual({ ok: true, url: "https://example.com/" });
    expect(normalizeDirectHttpUrl("javascript:alert(1)").ok).toBe(false);
    expect(normalizeDirectHttpUrl("https://user:pass@example.com").ok).toBe(false);
    expect(verifyExactHttpUrl("https://example.com/", "https://example.com").verified).toBe(true);
    expect(verifyExactHttpUrl("https://example.com/other", "https://example.com/").verified).toBe(false);
  });

  it("requires YouTube's exact results route and query", () => {
    expect(verifyYouTubeSearchUrl(youtubeSearchUrl("AVA test"), "AVA test").verified).toBe(true);
    expect(verifyYouTubeSearchUrl("https://youtube.com.evil.test/results?search_query=AVA", "AVA").verified).toBe(false);
    expect(verifyYouTubeSearchUrl("https://www.youtube.com/results?search_query=other", "AVA").verified).toBe(false);
  });
});
