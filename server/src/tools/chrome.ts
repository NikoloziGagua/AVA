import { mkdirSync, existsSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserContext, Page } from "playwright";
import { chromium } from "playwright";

export function ensureProfileDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, "SingletonLock");
  if (existsSync(lock)) {
    rmSync(lock, { force: true });
  }
}

export type Chrome = {
  navigate: (url: string) => Promise<{ ok: boolean; reason?: string; title?: string }>;
  click: (selector: string) => Promise<{ ok: boolean; reason?: string }>;
  type: (selector: string, text: string) => Promise<{ ok: boolean; reason?: string }>;
  press: (key: string) => Promise<{ ok: boolean; reason?: string }>;
  readPage: () => Promise<{ ok: boolean; text?: string; reason?: string }>;
  snapshot: () => Promise<{ ok: boolean; text?: string; reason?: string }>;
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
};

export async function buildChrome(cfg: ChromeConfig): Promise<Chrome> {
  ensureProfileDir(cfg.profileDir);
  mkdirSync(cfg.screenshotDir, { recursive: true });

  const ctx: BrowserContext = await chromium.launchPersistentContext(cfg.profileDir, {
    headless: false,
  });
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
    isAlive() {
      return alive;
    },
    async close() {
      alive = false;
      await ctx.close();
    },
  };
}
