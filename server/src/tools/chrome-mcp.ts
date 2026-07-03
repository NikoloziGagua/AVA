// server/src/tools/chrome-mcp.ts
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Chrome } from "./chrome.js";

export type ChromeToolEvent =
  | { kind: "chrome.call"; tool: string; args: unknown }
  | { kind: "chrome.result"; tool: string; ok: boolean; result: string };

export type ChromeToolDef = {
  tool: Tool;
  run: (args: Record<string, unknown>) => Promise<{ text: string; ok: boolean }>;
};

type ChromeRun = (chrome: Chrome, args: Record<string, unknown>) => Promise<{ text: string; ok: boolean }>;

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
