import { describe, it, expect } from "vitest";
import { chromium } from "playwright";
import { startTestServer } from "./setup.js";

describe("approval flow (e2e)", () => {
  it(
    "happy path: high-risk shell triggers approval card; clicking Approve drives the chat to a final 'ok' message",
    async () => {
      const srv = await startTestServer();
      const browser = await chromium.launch({ headless: true });
      try {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();

        // Pre-seed localStorage so the PWA skips the pairing screen.
        await page.addInitScript((token: string) => {
          localStorage.setItem("ava.token", token);
        }, srv.token);

        await page.goto(srv.url + "/");

        // Command bar on the orbit home screen ("Ask Ava, or tell her to do
        // something…"); falls through to the chat composer ("Message Ava…").
        const composer = page.getByPlaceholder(/Ask Ava|Message Ava/i);
        await composer.waitFor({ state: "visible", timeout: 10_000 });

        await composer.fill("run rm -rf C:/tmp/x");
        await page.getByRole("button", { name: /^send$/i }).click();

        // Approval card appears.
        const card = page.getByTestId("approval-card");
        await card.waitFor({ state: "visible", timeout: 10_000 });

        await page.getByTestId("approval-approve").click();

        // Resolved-state replaces the live card.
        await page.getByTestId("approval-card-resolved").waitFor({ state: "visible", timeout: 10_000 });

        // Final assistant reply "ok". The live-stream bubble (testid
        // final-message) is transient: once the run finishes the list refetches
        // persisted messages and re-renders the reply without the testid — so
        // assert on the visible reply text, which covers both render paths.
        const final = page.getByText("ok", { exact: true }).first();
        await final.waitFor({ state: "visible", timeout: 10_000 });
        expect(((await final.textContent()) ?? "").trim()).toBe("ok");

        await ctx.close();
      } finally {
        await browser.close();
        await srv.close();
      }
    },
    60_000,
  );
});
