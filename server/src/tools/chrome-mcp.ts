// server/src/tools/chrome-mcp.ts
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { createHash } from "node:crypto";
import type { ToolVerificationEvidence } from "../orchestrator/verification-evidence.js";
import { scrubSecrets } from "../security/scrub.js";
import type { Chrome } from "./chrome.js";

export type ChromeToolEvent =
  | { kind: "chrome.call"; tool: string; args: unknown }
  | { kind: "chrome.result"; tool: string; ok: boolean; result: string };

export type ChromeToolDef = {
  tool: Tool;
  run: (args: Record<string, unknown>) => Promise<{
    text: string;
    ok: boolean;
    verification?: ToolVerificationEvidence;
  }>;
};

type ChromeRun = (chrome: Chrome, args: Record<string, unknown>) => Promise<{
  text: string;
  ok: boolean;
  verification?: ToolVerificationEvidence;
}>;

export function googleSearchUrl(query: string): string {
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("q", query);
  return url.toString();
}

export function verifyGoogleSearchUrl(current: string, query: string): {
  verified: boolean;
  reason: string;
} {
  try {
    const url = new URL(current);
    const googleHost = /^(?:www\.)?google\.(?:com|co\.uk)$/i.test(url.hostname);
    if (!googleHost || url.pathname !== "/search") {
      return { verified: false, reason: "The active page is not a supported Google search-results URL." };
    }
    if (url.searchParams.get("q") !== query) {
      return { verified: false, reason: "The active Google results URL does not contain the exact requested query." };
    }
    return { verified: true, reason: "The active page is Google's search route with the exact requested query." };
  } catch {
    return { verified: false, reason: "The browser returned an invalid active-page URL." };
  }
}

export function buildChromeTools(opts: {
  /**
   * Lazy accessor for the persistent Chromium context. Chrome only boots when a
   * chrome_* tool is actually dispatched — defining the tools is free, so a chat
   * turn that never browses never pays the launch cost. The accessor memoizes
   * and reuses the live instance, so repeated calls are cheap.
   */
  getChrome: () => Promise<Chrome>;
  emit: (e: ChromeToolEvent) => void;
}): ChromeToolDef[] {
  const { getChrome, emit } = opts;
  const wrap =
    (name: string, run: ChromeRun): ChromeToolDef["run"] =>
    async (args) => {
      emit({ kind: "chrome.call", tool: name, args });
      const chrome = await getChrome();
      const r = await run(chrome, args);
      emit({ kind: "chrome.result", tool: name, ok: r.ok, result: r.text });
      return r;
    };

  return [
    {
      tool: {
        name: "chrome_google_search",
        description:
          "Fast deterministic Google search in AVA's persistent Chrome. Use this " +
          "instead of chrome_open + typing, computer_use, control_app, shell, or " +
          "Microsoft UFO when Sir asks to open Google and search for one query. It " +
          "opens the exact encoded search URL, foregrounds AVA Chrome, and verifies " +
          "the active Google /search URL and q parameter before reporting success.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", minLength: 1, maxLength: 500 },
          },
          required: ["query"],
          additionalProperties: false,
        },
      },
      run: wrap("chrome_google_search", async (chrome, args) => {
        const query = typeof args.query === "string" ? args.query.replace(/\s+/g, " ").trim() : "";
        if (!query || query.length > 500) {
          return { ok: false, text: "error: Google search query must be between 1 and 500 characters." };
        }
        if (scrubSecrets(query) !== query) {
          return { ok: false, text: "error: search query appears to contain a credential or secret and was not sent." };
        }

        const target = googleSearchUrl(query);
        const alreadyThere = verifyGoogleSearchUrl(chrome.url(), query).verified;
        const opened = await chrome.open(alreadyThere ? undefined : target);
        if (!opened.ok) return { ok: false, text: `error: ${opened.reason}` };

        const observedAt = Date.now();
        const verified = verifyGoogleSearchUrl(chrome.url(), query);
        const queryRef = createHash("sha256").update(query, "utf8").digest("hex").slice(0, 16);
        const verification: ToolVerificationEvidence = {
          state: verified.verified ? "verified" : "contradicted",
          scope: "task_outcome",
          method: "chrome_google_search_url",
          summary: verified.reason,
          evidenceRef: `google-search:${queryRef}`,
          observedAt,
        };
        if (!verified.verified) {
          return {
            ok: false,
            text: `error: Google search opened, but verification failed: ${verified.reason}`,
            verification,
          };
        }

        const shown = query.length > 180 ? `${query.slice(0, 177)}...` : query;
        return {
          ok: true,
          text:
            `Google is open in AVA Chrome with results for “${shown}”. ` +
            `Route: direct persistent browser (faster and more precise than visual control).`,
          verification,
        };
      }),
    },
    {
      tool: {
        name: "chrome_open",
        description:
          "Open and foreground AVA's persistent logged-in Chrome window. AVA starts " +
          "its dedicated browser launcher automatically when the window is not already " +
          "alive. Use this for every request to 'open Chrome'; never launch a separate " +
          "Chrome with shell. An optional URL opens in the active tab.",
        inputSchema: {
          type: "object",
          properties: { url: { type: "string", description: "Optional URL to open." } },
          required: [],
        },
      },
      run: wrap("chrome_open", async (chrome, args) => {
        const url = typeof args.url === "string" && args.url.trim() ? args.url.trim() : undefined;
        const r = await chrome.open(url);
        return r.ok
          ? { ok: true, text: `AVA Chrome is visible${r.title ? `: ${r.title}` : ""}` }
          : { ok: false, text: `error: ${r.reason}` };
      }),
    },
    {
      tool: {
        name: "chrome_navigate",
        description: "Navigate the active tab to a URL. Returns the page title.",
        inputSchema: {
          type: "object",
          properties: { url: { type: "string" } },
          required: ["url"],
        },
      },
      run: wrap("chrome_navigate", async (chrome, args) => {
        const r = await chrome.navigate(String(args.url ?? ""));
        return r.ok
          ? { ok: true, text: `loaded: ${r.title ?? ""}` }
          : { ok: false, text: `error: ${r.reason}` };
      }),
    },
    {
      tool: {
        name: "chrome_click",
        description:
          "Click an element. Selector can be CSS, text=..., or an aria-ref handle " +
          "from chrome_snapshot (selector: 'aria-ref=e12' — exact, preferred on " +
          "complex apps where text matches the wrong node). Clicks the first " +
          "VISIBLE match; hidden-duplicate matches fail fast with a diagnosis.",
        inputSchema: {
          type: "object",
          properties: { selector: { type: "string" } },
          required: ["selector"],
        },
      },
      run: wrap("chrome_click", async (chrome, args) => {
        const r = await chrome.click(String(args.selector ?? ""));
        return r.ok ? { ok: true, text: "clicked" } : { ok: false, text: `error: ${r.reason}` };
      }),
    },
    {
      tool: {
        name: "chrome_type",
        description: "Fill text into an input matched by selector.",
        inputSchema: {
          type: "object",
          properties: { selector: { type: "string" }, text: { type: "string" } },
          required: ["selector", "text"],
        },
      },
      run: wrap("chrome_type", async (chrome, args) => {
        const r = await chrome.type(String(args.selector ?? ""), String(args.text ?? ""));
        return r.ok ? { ok: true, text: "typed" } : { ok: false, text: `error: ${r.reason}` };
      }),
    },
    {
      tool: {
        name: "chrome_press_key",
        description: "Send a key to the active page (e.g. 'Enter', 'Tab', 'Escape').",
        inputSchema: {
          type: "object",
          properties: { key: { type: "string" } },
          required: ["key"],
        },
      },
      run: wrap("chrome_press_key", async (chrome, args) => {
        const r = await chrome.press(String(args.key ?? ""));
        return r.ok ? { ok: true, text: "pressed" } : { ok: false, text: `error: ${r.reason}` };
      }),
    },
    {
      tool: {
        name: "chrome_snapshot",
        description:
          "Return the page's INTERACTIVE structure: an accessibility tree where every " +
          "element carries a [ref=eN] handle. Use this instead of guessing selectors on " +
          "complex apps (Instagram, Gmail): find the right button/link/textbox in the " +
          "tree, then chrome_click / chrome_type with selector 'aria-ref=eN'.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      run: wrap("chrome_snapshot", async (chrome) => {
        const r = await chrome.snapshot();
        if (!r.ok) return { ok: false, text: `error: ${r.reason}` };
        const t = r.text ?? "";
        return {
          ok: true,
          text: t.length > 14000 ? t.slice(0, 14000) + "\n... [truncated — snapshot again after narrowing the page]" : t,
        };
      }),
    },
    {
      tool: {
        name: "chrome_read_page",
        description: "Return the visible text content of the active page (innerText of body).",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      run: wrap("chrome_read_page", async (chrome) => {
        const r = await chrome.readPage();
        if (!r.ok) return { ok: false, text: `error: ${r.reason}` };
        const t = r.text ?? "";
        return {
          ok: true,
          text: t.length > 8192 ? t.slice(0, 8192) + "\n... [truncated]" : t,
        };
      }),
    },
    {
      tool: {
        name: "chrome_screenshot",
        description: "Save a PNG screenshot of the active page; returns the file path.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      run: wrap("chrome_screenshot", async (chrome) => {
        const r = await chrome.screenshot();
        return r.ok
          ? { ok: true, text: `saved: ${r.path}` }
          : { ok: false, text: `error: ${r.reason}` };
      }),
    },
    {
      tool: {
        name: "chrome_tabs",
        description: "List currently open tabs (index/url/title).",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      run: wrap("chrome_tabs", async (chrome) => {
        const r = await chrome.tabs();
        if (!r.ok || !r.tabs) return { ok: false, text: "error: tabs unavailable" };
        return {
          ok: true,
          text: r.tabs.map((t) => `[${t.index}] ${t.title} — ${t.url}`).join("\n"),
        };
      }),
    },
  ];
}
