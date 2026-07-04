import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Chrome } from "../tools/chrome.js";
import { detectWaState, ensureReady, openChat, sendMessage, type WaDeps } from "./whatsapp.js";
import { upsertPerson } from "./people.js";

const QR_TEXT = "Use WhatsApp on your computer\nScan the QR code with your phone\nLog into WhatsApp Web";
const APP_TEXT = "Chats\nSearch or start a new chat\nLasha\nyesterday\nMom\nMonday";

function makeChrome() {
  const chrome = {
    navigate: vi.fn(async () => ({ ok: true })),
    click: vi.fn(async () => ({ ok: true })),
    type: vi.fn(async () => ({ ok: true })),
    press: vi.fn(async () => ({ ok: true })),
    readPage: vi.fn(async () => ({ ok: true, text: APP_TEXT })),
    snapshot: vi.fn(async () => ({ ok: true, text: "" })),
    url: vi.fn(() => "https://web.whatsapp.com/"),
    screenshot: vi.fn(async () => ({ ok: true })),
    tabs: vi.fn(async () => ({ ok: true, tabs: [] })),
    mouseClick: vi.fn(async () => ({ ok: true })),
    mouseWheel: vi.fn(async () => ({ ok: true })),
    keyboardType: vi.fn(async () => ({ ok: true })),
    keyboardPress: vi.fn(async () => ({ ok: true })),
    screenshotBytes: vi.fn(async () => ({ ok: true })),
    viewport: vi.fn(() => ({ width: 1280, height: 720 })),
    isAlive: vi.fn(() => true),
    close: vi.fn(async () => {}),
  } as unknown as Chrome;
  return chrome;
}

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ava-wa-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const FAST = { ready: 0, search: 0, result: 0, send: 0 };
const depsWith = (chrome: Chrome): WaDeps => ({ chrome, memoryDir: dir, waits: FAST });

describe("detectWaState (preview false-positive regression)", () => {
  it("QR marker with no app chrome -> qr", () => {
    expect(detectWaState(QR_TEXT, "https://web.whatsapp.com/")).toBe("qr");
  });
  it("a chat PREVIEW mentioning the QR code does not log Ava out", () => {
    const preview = `${APP_TEXT}\nLasha: just scan the QR code they sent us`;
    expect(detectWaState(preview, "https://web.whatsapp.com/")).toBe("in");
  });
  it("plain app text -> in", () => {
    expect(detectWaState(APP_TEXT, "https://web.whatsapp.com/")).toBe("in");
  });
});

describe("ensureReady", () => {
  it("needs qr with linking instructions when logged out", async () => {
    const chrome = makeChrome();
    (chrome.readPage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, text: QR_TEXT });
    const res = await ensureReady(depsWith(chrome));
    expect(res.ok).toBe(false);
    expect(res.needs).toBe("qr");
    expect(res.detail).toContain("Linked devices");
  });
});

describe("openChat (wrong-recipient regressions)", () => {
  it("refuses when no snapshot row matches the EXACT display name", async () => {
    upsertPerson(dir, { name: "Lasha", whatsapp: { username: "Lasha" } });
    const chrome = makeChrome();
    // Search results contain only a group that CONTAINS the name — exact-name
    // row selection must not click it.
    (chrome.snapshot as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      text: '- listitem "Lasha & Nika trip" [ref=e10]\n- listitem "Lasha marketing" [ref=e11]',
    });
    const res = await openChat(depsWith(chrome), "Lasha");
    expect(res.ok).toBe(false);
    expect(res.needs).toBe("username");
    expect(res.detail).toContain('exactly "Lasha"');
  });

  it("fails closed when the conversation pane header doesn't show the name after the click", async () => {
    upsertPerson(dir, { name: "Lasha", whatsapp: { username: "Lasha" } });
    const chrome = makeChrome();
    (chrome.snapshot as ReturnType<typeof vi.fn>)
      // row-selection snapshot: an exact "Lasha" row exists
      .mockResolvedValueOnce({ ok: true, text: '- listitem "Lasha" [ref=e10]' })
      // post-click snapshot: main pane shows a DIFFERENT chat
      .mockResolvedValueOnce({ ok: true, text: '- main [ref=e50]:\n  - generic "Family group"' });
    const res = await openChat(depsWith(chrome), "Lasha");
    expect(res.ok).toBe(false);
    expect(res.detail).toContain("do NOT send");
  });

  it("opens and verifies when the main pane shows the person", async () => {
    upsertPerson(dir, { name: "Lasha", whatsapp: { username: "Lasha" } });
    const chrome = makeChrome();
    (chrome.snapshot as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, text: '- listitem "Lasha" [ref=e10]' })
      .mockResolvedValueOnce({ ok: true, text: '- main [ref=e50]:\n  - generic "Lasha"\n  - textbox [ref=e60]:' });
    const res = await openChat(depsWith(chrome), "Lasha");
    expect(res.ok).toBe(true);
    expect(res.detail).toContain("header verified");
    expect(chrome.click).toHaveBeenCalledWith("aria-ref=e10");
  });
});

describe("sendMessage honesty", () => {
  function chromeWithChatOpen() {
    const chrome = makeChrome();
    (chrome.snapshot as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, text: '- listitem "Lasha" [ref=e10]' })
      .mockResolvedValueOnce({ ok: true, text: '- main [ref=e50]:\n  - generic "Lasha"' });
    return chrome;
  }

  it("reports sent only when the text left the composer and appears in the chat", async () => {
    upsertPerson(dir, { name: "Lasha", whatsapp: { username: "Lasha" } });
    const chrome = chromeWithChatOpen();
    (chrome.readPage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, text: `${APP_TEXT}\nhello from ava` });
    (chrome.snapshot as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, text: "- textbox [ref=e60]:" });
    const res = await sendMessage(depsWith(chrome), "Lasha", "hello from ava");
    expect(res.ok).toBe(true);
    expect(res.detail).toContain("verified on the page");
  });

  it("fails when the message is still sitting in the composer", async () => {
    upsertPerson(dir, { name: "Lasha", whatsapp: { username: "Lasha" } });
    const chrome = chromeWithChatOpen();
    (chrome.readPage as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, text: `${APP_TEXT}\nhello from ava` });
    (chrome.snapshot as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      text: '- textbox [ref=e60]:\n    - text: hello from ava',
    });
    const res = await sendMessage(depsWith(chrome), "Lasha", "hello from ava");
    expect(res.ok).toBe(false);
    expect(res.detail).toContain("still in the composer");
  });
});
