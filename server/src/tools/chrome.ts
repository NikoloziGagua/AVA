import { mkdirSync, existsSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";

const execFileAsync = promisify(execFile);
const focusScript = fileURLToPath(
  new URL("../../../scripts/focus-ava-browser.ps1", import.meta.url),
);

export function ensureProfileDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, "SingletonLock");
  if (existsSync(lock)) {
    rmSync(lock, { force: true });
  }
}

export type Chrome = {
  /** Bring AVA's persistent logged-in browser window/tab to the foreground. */
  open: (url?: string) => Promise<{ ok: boolean; reason?: string; title?: string }>;
  navigate: (url: string) => Promise<{ ok: boolean; reason?: string; title?: string }>;
  click: (selector: string) => Promise<{ ok: boolean; reason?: string }>;
  type: (selector: string, text: string) => Promise<{ ok: boolean; reason?: string }>;
  press: (key: string) => Promise<{ ok: boolean; reason?: string }>;
  readPage: () => Promise<{ ok: boolean; text?: string; reason?: string }>;
  snapshot: () => Promise<{ ok: boolean; text?: string; reason?: string }>;
  url: () => string;
  screenshot: () => Promise<{ ok: boolean; path?: string; reason?: string }>;
  tabs: () => Promise<{ ok: boolean; tabs?: Array<{ index: number; url: string; title: string }> }>;
  mouseClick: (x: number, y: number) => Promise<{ ok: boolean; reason?: string }>;
  mouseWheel: (deltaY: number) => Promise<{ ok: boolean; reason?: string }>;
  keyboardType: (text: string) => Promise<{ ok: boolean; reason?: string }>;
  keyboardPress: (key: string) => Promise<{ ok: boolean; reason?: string }>;
  screenshotBytes: () => Promise<{
    ok: boolean;
    base64?: string;
    path?: string;
    reason?: string;
  }>;
  viewport: () => { width: number; height: number };
  /** True until the user closes the Chromium window or the underlying browser disconnects. */
  isAlive: () => boolean;
  close: () => Promise<void>;
};

export type ChromeConfig = {
  profileDir: string;
  screenshotDir: string;
  /** Optional installed Chrome/Edge executable. Auto-detected on Windows. */
  executablePath?: string | null;
  /** Optional already-running Chrome DevTools endpoint, e.g. http://127.0.0.1:9222. */
  cdpUrl?: string | null;
};

type WindowFocusResult = {
  ok: boolean;
  visible?: boolean;
  foreground?: boolean;
  reason?: string;
  title?: string;
};

function cdpPort(cdpUrl: string | null): number {
  if (!cdpUrl) return 9222;
  try {
    const parsed = new URL(cdpUrl);
    return Number(parsed.port) || 9222;
  } catch {
    return 9222;
  }
}

async function focusAvaBrowserWindow(
  profileDir: string,
  executablePath: string | null | undefined,
  port: number,
): Promise<WindowFocusResult> {
  if (process.platform !== "win32") {
    return { ok: true, visible: true, foreground: true };
  }

  try {
    const args = [
      "-NoLogo",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      focusScript,
      "-Port",
      String(port),
      "-ProfileDir",
      profileDir,
    ];
    if (executablePath) args.push("-ExecutablePath", executablePath);

    const { stdout } = await execFileAsync("powershell.exe", args, {
      timeout: 12_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    const line = stdout
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)
      .at(-1);
    if (!line) return { ok: false, reason: "Windows returned no AVA Chrome window status." };
    return JSON.parse(line) as WindowFocusResult;
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function restoreCdpWindow(page: Page): Promise<void> {
  const session = await page.context().newCDPSession(page);
  try {
    const current = await session.send("Browser.getWindowForTarget");
    if (current.bounds.windowState === "minimized") {
      await session.send("Browser.setWindowBounds", {
        windowId: current.windowId,
        bounds: { windowState: "normal" },
      });
    }
  } finally {
    await session.detach();
  }
}

/** Locate an installed browser so AVA does not depend on Playwright's downloaded Chromium. */
export function findInstalledBrowser(
  explicitPath: string | null | undefined = null,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const candidates = [
    explicitPath,
    env.PROGRAMFILES ? join(env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe") : null,
    env["PROGRAMFILES(X86)"] ? join(env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe") : null,
    env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe") : null,
    env.PROGRAMFILES ? join(env.PROGRAMFILES, "Microsoft", "Edge", "Application", "msedge.exe") : null,
    env["PROGRAMFILES(X86)"] ? join(env["PROGRAMFILES(X86)"], "Microsoft", "Edge", "Application", "msedge.exe") : null,
    env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe") : null,
  ].filter((p): p is string => !!p);
  return candidates.find((p) => existsSync(p)) ?? null;
}

function launchFailure(error: unknown, executablePath: string | null, cdpUrl: string | null): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/spawn EPERM|access is denied/i.test(message)) {
    return new Error(
      "Windows blocked AVA from launching Chrome. Run scripts/start-ava-browser.ps1 once " +
      "outside the managed runner, then retry; AVA will attach through " +
      `${cdpUrl ?? "http://127.0.0.1:9222"}.`,
    );
  }
  if (/Executable doesn't exist/i.test(message)) {
    return new Error(
      "No usable browser executable was found. Install Google Chrome or set " +
      "CHROME_EXECUTABLE_PATH; downloading Playwright Chromium is not required.",
    );
  }
  return new Error(
    `AVA browser failed (${executablePath ?? "Playwright default"}): ${message}`,
  );
}

export async function buildChrome(cfg: ChromeConfig): Promise<Chrome> {
  mkdirSync(cfg.profileDir, { recursive: true });
  mkdirSync(cfg.screenshotDir, { recursive: true });

  let attachedBrowser: Browser | null = null;
  let attachedOverCdp = false;
  let ctx: BrowserContext | null = null;
  const cdpUrl = cfg.cdpUrl?.trim() || null;
  const executablePath = findInstalledBrowser(cfg.executablePath);
  if (cdpUrl) {
    try {
      attachedBrowser = await chromium.connectOverCDP(cdpUrl, { timeout: 2_500 });
      ctx = attachedBrowser.contexts()[0] ?? null;
      attachedOverCdp = ctx !== null;
    } catch {
      attachedBrowser = null;
      ctx = null;
    }
  }

  if (!ctx) {
    ensureProfileDir(cfg.profileDir);
    try {
      ctx = await chromium.launchPersistentContext(cfg.profileDir, {
        headless: false,
        ...(executablePath ? { executablePath } : {}),
      });
    } catch (error) {
      throw launchFailure(error, executablePath, cdpUrl);
    }
  }

  let page: Page = ctx.pages()[0] ?? (await ctx.newPage());
  let alive = true;

  // Track active page; clicking links that open new tabs should update it.
  ctx.on("page", (p) => {
    page = p;
    p.on("close", () => {
      // If this was the only page, mark dead so callers rebuild.
      if (ctx.pages().length === 0) alive = false;
    });
  });
  ctx.on("close", () => { alive = false; });
  // browser() exists for persistent contexts; use it as an extra disconnect signal.
  ctx.browser()?.on("disconnected", () => { alive = false; });

  return {
    async open(url) {
      try {
        if (url) {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        }
        if (attachedOverCdp) await restoreCdpWindow(page);
        await page.bringToFront();
        const focused = await focusAvaBrowserWindow(
          cfg.profileDir,
          executablePath,
          cdpPort(cdpUrl),
        );
        if (!focused.ok || !focused.visible) {
          return {
            ok: false,
            reason:
              focused.reason ??
              "Windows did not confirm a visible AVA-profile Chrome window.",
          };
        }
        return { ok: true, title: await page.title().catch(() => "") };
      } catch (e) {
        return { ok: false, reason: String(e instanceof Error ? e.message : e) };
      }
    },
    async navigate(url) {
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        return { ok: true, title: await page.title() };
      } catch (e) {
        return { ok: false, reason: String(e instanceof Error ? e.message : e) };
      }
    },
    async click(selector) {
      // Modern SPAs (Instagram!) render duplicate HIDDEN nodes with the same
      // text. page.click() grabs the FIRST match, waits the full timeout for a
      // hidden node to become actionable, and dies — observed live 2026-07-03
      // ("text=Nika gagua" timeout, "Messages" hit a hidden duplicate). So:
      // target the first VISIBLE match, and when that's impossible, fail FAST
      // with a diagnosis the model can act on instead of a blind timeout.
      try {
        const base = page.locator(selector);
        // Brief grace for the node to render at all (SPA navigation).
        try { await base.first().waitFor({ state: "attached", timeout: 3_000 }); } catch { /* diagnosed below */ }
        const count = await base.count();
        if (count === 0) {
          return { ok: false, reason: `no matches for ${selector} — check chrome_read_page for the actual text/controls` };
        }
        const visible = base.filter({ visible: true });
        const visibleCount = await visible.count();
        if (visibleCount === 0) {
          return {
            ok: false,
            reason: `${count} match(es) for ${selector}, none visible (hidden duplicates) — use a more specific selector, or scroll/open the right panel first`,
          };
        }
        await visible.first().click({ timeout: 7_000 });
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: String(e instanceof Error ? e.message : e) };
      }
    },
    async type(selector, text) {
      try {
        const base = page.locator(selector);
        try { await base.first().waitFor({ state: "attached", timeout: 3_000 }); } catch { /* diagnosed below */ }
        const count = await base.count();
        if (count === 0) {
          return { ok: false, reason: `no matches for ${selector} — check chrome_read_page for the actual field` };
        }
        const visible = base.filter({ visible: true });
        if ((await visible.count()) === 0) {
          return { ok: false, reason: `${count} match(es) for ${selector}, none visible — the real input is elsewhere; try a more specific selector` };
        }
        await visible.first().fill(text, { timeout: 7_000 });
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: String(e instanceof Error ? e.message : e) };
      }
    },
    async press(key) {
      try {
        await page.keyboard.press(key);
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: String(e instanceof Error ? e.message : e) };
      }
    },
    async readPage() {
      try {
        const text = ((await page.evaluate("document.body.innerText")) as string) ?? "";
        return { ok: true, text };
      } catch (e) {
        return { ok: false, reason: String(e instanceof Error ? e.message : e) };
      }
    },
    async snapshot() {
      // Accessibility snapshot with [ref=eN] element handles. On SPA soups
      // (Instagram) text selectors hit the wrong node; refs are exact: click
      // with selector "aria-ref=e12". Same mechanism playwright-mcp uses.
      try {
        const text = await page.ariaSnapshot({ mode: "ai", timeout: 10_000 });
        return { ok: true, text };
      } catch (e) {
        return { ok: false, reason: String(e instanceof Error ? e.message : e) };
      }
    },
    async screenshot() {
      try {
        const filename = `${Date.now()}.png`;
        const path = join(cfg.screenshotDir, filename);
        await page.screenshot({ path });
        return { ok: true, path };
      } catch (e) {
        return { ok: false, reason: String(e instanceof Error ? e.message : e) };
      }
    },
    async tabs() {
      const pages = ctx.pages();
      const tabs = await Promise.all(
        pages.map(async (p, index) => ({
          index,
          url: p.url(),
          title: await p.title().catch(() => ""),
        })),
      );
      return { ok: true, tabs };
    },
    async mouseClick(x, y) {
      try {
        await page.mouse.click(x, y);
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: String(e instanceof Error ? e.message : e) };
      }
    },
    async mouseWheel(deltaY) {
      try {
        await page.mouse.wheel(0, deltaY);
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: String(e instanceof Error ? e.message : e) };
      }
    },
    async keyboardType(text) {
      try {
        await page.keyboard.type(text);
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: String(e instanceof Error ? e.message : e) };
      }
    },
    async keyboardPress(key) {
      try {
        await page.keyboard.press(key);
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: String(e instanceof Error ? e.message : e) };
      }
    },
    async screenshotBytes() {
      try {
        const filename = `${Date.now()}.png`;
        const path = join(cfg.screenshotDir, filename);
        const buf = await page.screenshot();
        await writeFile(path, buf);
        return { ok: true, base64: buf.toString("base64"), path };
      } catch (e) {
        return { ok: false, reason: String(e instanceof Error ? e.message : e) };
      }
    },
    viewport() {
      const vp = page.viewportSize() ?? { width: 1280, height: 720 };
      return vp;
    },
    url() {
      try { return page.url(); } catch { return ""; }
    },
    isAlive() {
      return alive;
    },
    async close() {
      alive = false;
      // A CDP browser is owned by the Windows launcher, not this server. Closing
      // its default context would shut the user's persistent AVA Chrome window.
      if (!attachedOverCdp) await ctx.close();
    },
  };
}
