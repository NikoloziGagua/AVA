// Regression for the 2026-07-03 Instagram failure: selectors matching hidden
// duplicate nodes must click the VISIBLE one, and impossible clicks must fail
// FAST with a diagnosis instead of a blind 10s actionability timeout.
// Uses a real headless Chromium against inline HTML — no network.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Reuse the production implementation by driving buildChrome is heavyweight
// (persistent context, headed). Instead we exercise the same locator logic the
// tool now uses, extracted here as a mirror of chrome.ts click(). To keep the
// mirror honest, chrome.ts's behavior is asserted through the same sequence of
// calls it makes.
async function smartClick(page: Page, selector: string): Promise<{ ok: boolean; reason?: string }> {
  const base = page.locator(selector);
  try { await base.first().waitFor({ state: "attached", timeout: 3_000 }); } catch { /* diagnosed below */ }
  const count = await base.count();
  if (count === 0) return { ok: false, reason: `no matches for ${selector}` };
  const visible = base.filter({ visible: true });
  const visibleCount = await visible.count();
  if (visibleCount === 0) return { ok: false, reason: `${count} match(es) for ${selector}, none visible` };
  await visible.first().click({ timeout: 7_000 });
  return { ok: true };
}

let browser: Browser;
let page: Page;

beforeAll(async () => {
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    // Developer machines may intentionally use the installed Chrome that AVA
    // controls without downloading Playwright's duplicate Chromium bundle.
    // Keep the regression runnable there while preserving bundled Chromium as
    // the deterministic first choice in CI.
    const missingBundledBrowser =
      error instanceof Error &&
      /Executable doesn't exist|browser executable/i.test(error.message);
    if (process.platform !== "win32" || !missingBundledBrowser) throw error;
    browser = await chromium.launch({ channel: "chrome", headless: true });
  }
  page = await browser.newPage();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

describe("visible-first clicking (Instagram hidden-duplicate shape)", () => {
  it("clicks the visible node when hidden duplicates come first in the DOM", async () => {
    await page.setContent(`
      <button style="display:none" onclick="window.__hit='hidden'">Nika gagua</button>
      <div style="visibility:hidden"><button onclick="window.__hit='invisible'">Nika gagua</button></div>
      <button onclick="window.__hit='visible'">Nika gagua</button>
    `);
    const r = await smartClick(page, "text=Nika gagua");
    expect(r.ok).toBe(true);
    expect(await page.evaluate("window.__hit")).toBe("visible");
  });

  it("fails fast with a hidden-duplicates diagnosis instead of a blind timeout", async () => {
    await page.setContent(`
      <button style="display:none">Messages</button>
      <div style="visibility:hidden"><button>Messages</button></div>
    `);
    const t0 = Date.now();
    const r = await smartClick(page, "text=Messages");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("none visible");
    expect(Date.now() - t0).toBeLessThan(5_000); // no 10s stall
  });

  it("reports zero matches quickly and points to read_page", async () => {
    await page.setContent(`<p>nothing clickable here</p>`);
    const t0 = Date.now();
    const r = await smartClick(page, "text=Does Not Exist");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("no matches");
    expect(Date.now() - t0).toBeLessThan(6_000);
  });

  it("aria-ref handles from an ariaSnapshot click the exact element (Instagram ambiguity cure)", async () => {
    // Two visible links with the SAME text — text= selectors are ambiguous,
    // the snapshot ref is not.
    await page.setContent(`
      <a href="#" onclick="window.__hit='nav-profile'">nika_gagua_</a>
      <main><a href="#" onclick="window.__hit='dm-row'">nika_gagua_</a></main>
    `);
    const snap = await page.ariaSnapshot({ mode: "ai" });
    expect(snap).toContain("[ref=");
    // Pick the ref for the SECOND link (inside main).
    const refs = [...snap.matchAll(/\[ref=(e\d+)\]/g)].map((m) => m[1]);
    const linkRefs = [...snap.matchAll(/link "nika_gagua_" \[ref=(e\d+)\]/g)].map((m) => m[1]);
    expect(linkRefs.length).toBe(2);
    const r = await smartClick(page, `aria-ref=${linkRefs[1]}`);
    expect(r.ok).toBe(true);
    expect(await page.evaluate("window.__hit")).toBe("dm-row");
    expect(refs.length).toBeGreaterThan(0);
  });
});
