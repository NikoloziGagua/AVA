import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Chrome } from "../tools/chrome.js";
import { detectState, ensureReady, login, openProfile, openThread, sendDm, type IgDeps } from "./instagram.js";
import { listPeople, upsertPerson } from "./people.js";

// Unit tests for the Instagram module, driven by a scripted fake Chrome.
// The real sleeps in the module run under fake timers so the suite is instant.

const BASE = "https://www.instagram.com";

const INBOX_TEXT = "Your messages\nSend private photos and messages to a friend or group.";
const PROFILE_TEXT = "lasha_b\n42 posts\n1,024 followers\nMessage\nFollow";
const PROFILE_MESSAGE_DRAWER = [
  '- button "Go back" [ref=e10]',
  '- button "Close" [ref=e11]',
  '- textbox [active] [ref=e42]',
  '- generic: Message...',
  '- button "Choose an emoji" [ref=e43]',
].join("\n");
const LOGIN_WALL_TEXT =
  "Instagram\nPhone number, username, or email\nPassword\nLog in\nOR\nSign up\nForgot password?";
const CHECKPOINT_TEXT = "Check your phone\nEnter the code we sent to +995 5** *** ***.";
const CHALLENGE_TEXT = "Help us keep Instagram safe\nComplete this quick check to continue.";
const WRONG_PASSWORD_TEXT =
  "Sorry, your password was incorrect. Please double-check your password.\nForgot password?";

/** A fully scripted fake Chrome: every method is a vi.fn with a sane default,
 *  plus a settable "current URL" the way the real driver tracks the page. */
function makeChrome(startUrl = `${BASE}/`) {
  let currentUrl = startUrl;
  const setUrl = (u: string) => { currentUrl = u; };
  const chrome = {
    open: vi.fn(async (url?: string) => {
      if (url) currentUrl = url;
      return { ok: true } as { ok: boolean; reason?: string; title?: string };
    }),
    navigate: vi.fn(async (url: string) => {
      currentUrl = url;
      return { ok: true } as { ok: boolean; reason?: string; title?: string };
    }),
    click: vi.fn(async (_selector: string) => (
      { ok: false, reason: "no matches" } as { ok: boolean; reason?: string }
    )),
    type: vi.fn(async (_selector: string, _text: string) => (
      { ok: true } as { ok: boolean; reason?: string }
    )),
    press: vi.fn(async (_key: string) => ({ ok: true } as { ok: boolean; reason?: string })),
    readPage: vi.fn(async () => (
      { ok: true, text: INBOX_TEXT } as { ok: boolean; text?: string; reason?: string }
    )),
    snapshot: vi.fn(async () => (
      { ok: true, text: "" } as { ok: boolean; text?: string; reason?: string }
    )),
    url: vi.fn(() => currentUrl),
    screenshot: vi.fn(async () => (
      { ok: true } as { ok: boolean; path?: string; reason?: string }
    )),
    tabs: vi.fn(async () => (
      { ok: true, tabs: [] } as { ok: boolean; tabs?: Array<{ index: number; url: string; title: string }> }
    )),
    mouseClick: vi.fn(async (_x: number, _y: number) => ({ ok: true } as { ok: boolean; reason?: string })),
    mouseWheel: vi.fn(async (_deltaY: number) => ({ ok: true } as { ok: boolean; reason?: string })),
    keyboardType: vi.fn(async (_text: string) => ({ ok: true } as { ok: boolean; reason?: string })),
    keyboardPress: vi.fn(async (_key: string) => ({ ok: true } as { ok: boolean; reason?: string })),
    screenshotBytes: vi.fn(async () => (
      { ok: true } as { ok: boolean; base64?: string; path?: string; reason?: string }
    )),
    viewport: vi.fn(() => ({ width: 1280, height: 720 })),
    isAlive: vi.fn(() => true),
    close: vi.fn(async () => {}),
  };
  return { chrome, setUrl, getUrl: () => currentUrl };
}

/** Run a module flow to completion under fake timers, flushing every sleep. */
async function settle<T>(fn: () => Promise<T>): Promise<T> {
  const p = fn();
  let settled = false;
  void p.then(() => { settled = true; }, () => { settled = true; });
  for (let i = 0; i < 50 && !settled; i++) {
    await vi.runAllTimersAsync();
  }
  if (!settled) throw new Error("flow did not settle under fake timers");
  return p;
}

let dir: string;

beforeEach(() => {
  vi.useFakeTimers();
  dir = mkdtempSync(join(tmpdir(), "ava-ig-"));
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

const depsWith = (chrome: Chrome): IgDeps => ({ chrome, memoryDir: dir });

// ── detectState ──────────────────────────────────────────────────────────────

describe("detectState", () => {
  it("reports 'in' on an ordinary logged-in page", () => {
    expect(detectState(INBOX_TEXT, `${BASE}/direct/inbox/`)).toBe("in");
  });

  it("reports 'wall' from the login-page URL even with empty page text", () => {
    expect(detectState("", `${BASE}/accounts/login/?next=%2Fdirect%2Finbox%2F`)).toBe("wall");
  });

  it("reports 'wall' from login-form text on a neutral URL", () => {
    expect(detectState(LOGIN_WALL_TEXT, `${BASE}/`)).toBe("wall");
  });

  it("reports 'checkpoint' when the page asks for a verification code", () => {
    expect(detectState(CHECKPOINT_TEXT, `${BASE}/`)).toBe("checkpoint");
  });

  it("prefers 'checkpoint' over 'wall' when both signals appear", () => {
    expect(detectState(`${CHECKPOINT_TEXT}\n${LOGIN_WALL_TEXT}`, `${BASE}/accounts/login/`)).toBe("checkpoint");
  });

  it("reports 'challenge' on a /challenge/ URL", () => {
    expect(detectState(CHALLENGE_TEXT, `${BASE}/challenge/?next=%2F`)).toBe("challenge");
  });

  it("only inspects the head of the page (first 4000 chars)", () => {
    const text = `${"x".repeat(4000)}\n${CHECKPOINT_TEXT}`;
    expect(detectState(text, `${BASE}/direct/inbox/`)).toBe("in");
  });
});

// ── ensureReady ──────────────────────────────────────────────────────────────

describe("ensureReady", () => {
  it("returns ok when already logged in", async () => {
    const { chrome } = makeChrome();
    const res = await settle(() => ensureReady(depsWith(chrome)));
    expect(res.ok).toBe(true);
    expect(chrome.navigate).toHaveBeenCalledWith(`${BASE}/direct/inbox/`);
  });

  it("needs login with the ask-Sir detail when the login wall is up", async () => {
    const { chrome, setUrl } = makeChrome();
    // Real IG redirects a logged-out /direct/inbox/ hit to the login URL —
    // detectState trusts the URL over page text (preview false-positive fix).
    chrome.navigate.mockImplementation(async () => {
      setUrl(`${BASE}/accounts/login/?next=%2Fdirect%2Finbox%2F`);
      return { ok: true };
    });
    chrome.readPage.mockResolvedValue({ ok: true, text: LOGIN_WALL_TEXT });
    const res = await settle(() => ensureReady(depsWith(chrome)));
    expect(res.ok).toBe(false);
    expect(res.needs).toBe("login");
    expect(res.detail).toContain("Ask Sir");
    expect(res.detail).toContain("username and password");
    expect(res.detail).toContain("instagram_login");
  });

  it("needs a code when Instagram raises a 2FA checkpoint", async () => {
    const { chrome, setUrl } = makeChrome();
    chrome.navigate.mockImplementation(async () => {
      setUrl(`${BASE}/accounts/login/two_factor?next=%2F`);
      return { ok: true };
    });
    chrome.readPage.mockResolvedValue({ ok: true, text: CHECKPOINT_TEXT });
    const res = await settle(() => ensureReady(depsWith(chrome)));
    expect(res.ok).toBe(false);
    expect(res.needs).toBe("code");
    expect(res.detail).toContain("verification code");
  });
});

// ── login ────────────────────────────────────────────────────────────────────

describe("login", () => {
  it("reports needs login with the rejected detail on a wrong password", async () => {
    const { chrome } = makeChrome();
    // Submit "succeeds" but Instagram keeps us on the login page with the error text.
    chrome.click.mockImplementation(async (selector: string) =>
      selector === 'button[type="submit"]'
        ? { ok: true }
        : { ok: false, reason: "no matches" });
    chrome.readPage.mockResolvedValue({ ok: true, text: WRONG_PASSWORD_TEXT });
    const res = await settle(() => login(depsWith(chrome), { username: "nika_gagua", password: "wrong-secret" }));
    expect(res.ok).toBe(false);
    expect(res.needs).toBe("login");
    expect(res.detail).toContain("rejected those credentials");
    expect(chrome.navigate).toHaveBeenCalledWith(`${BASE}/accounts/login/`);
    expect(chrome.type).toHaveBeenNthCalledWith(1, 'input[name="username"]', "nika_gagua");
    expect(chrome.type).toHaveBeenNthCalledWith(2, 'input[name="password"]', "wrong-secret");
  });

  it("reports needs code when the checkpoint appears after submitting", async () => {
    const { chrome } = makeChrome();
    chrome.click.mockImplementation(async (selector: string) =>
      selector === 'button[type="submit"]'
        ? { ok: true }
        : { ok: false, reason: "no matches" });
    chrome.readPage.mockResolvedValue({ ok: true, text: CHECKPOINT_TEXT });
    const res = await settle(() => login(depsWith(chrome), { username: "nika_gagua", password: "right-secret" }));
    expect(res.ok).toBe(false);
    expect(res.needs).toBe("code");
    expect(res.detail).toContain("verification code");
  });

  it("returns ok when the session lands on a logged-in page", async () => {
    const { chrome, setUrl } = makeChrome();
    chrome.click.mockImplementation(async (selector: string) => {
      if (selector === 'button[type="submit"]') { setUrl(`${BASE}/`); return { ok: true }; }
      return { ok: false, reason: "no matches" };
    });
    const res = await settle(() => login(depsWith(chrome), { username: "nika_gagua", password: "right-secret" }));
    expect(res).toEqual({ ok: true, detail: "Logged in to Instagram." });
  });
});

describe("openProfile", () => {
  it("opens an unknown plain name as safe search results without learning a guessed account", async () => {
    const { chrome } = makeChrome();

    const res = await settle(() => openProfile(depsWith(chrome), "Lasha"));

    expect(res.ok).toBe(true);
    expect(res.detail).toContain("search");
    expect(chrome.navigate).toHaveBeenLastCalledWith(
      `${BASE}/explore/search/keyword/?q=Lasha`,
    );
    expect(listPeople(dir)).toEqual([]);
  });

  it("opens a known username directly without entering a DM", async () => {
    upsertPerson(dir, { name: "Lasha", instagram: { username: "lasha_b" } });
    const { chrome } = makeChrome();

    const res = await settle(() => openProfile(depsWith(chrome), "Lasha"));

    expect(res.ok).toBe(true);
    expect(res.detail).toContain("no message sent");
    expect(chrome.navigate).toHaveBeenLastCalledWith(`${BASE}/lasha_b/`);
  });
});

// ── openThread ───────────────────────────────────────────────────────────────

describe("openThread", () => {
  it("ignores a learned thread route and re-enters through the saved username profile", async () => {
    upsertPerson(dir, { name: "Lasha", instagram: { username: "lasha_b", threadId: "424242" } });
    const { chrome, setUrl } = makeChrome();
    chrome.readPage.mockResolvedValue({ ok: true, text: PROFILE_TEXT });
    chrome.click.mockImplementation(async (selector: string) => {
      if (selector === 'text="Message"') {
        setUrl(`${BASE}/direct/t/777888999/`);
        return { ok: true };
      }
      return { ok: false, reason: "no matches" };
    });
    const res = await settle(() => openThread(depsWith(chrome), "Lasha"));
    expect(res.ok).toBe(true);
    expect(res.threadId).toBe("777888999");
    expect(res.detail).toContain("verified profile @lasha_b");
    expect(res.person?.name).toBe("Lasha");
    expect(chrome.navigate.mock.calls.map((c) => c[0])).toEqual([
      `${BASE}/lasha_b/`,
    ]);
    expect(chrome.click).toHaveBeenCalledWith('text="Message"');
    expect(chrome.navigate).not.toHaveBeenCalledWith(`${BASE}/direct/t/424242/`);
    expect(chrome.navigate).not.toHaveBeenCalledWith(`${BASE}/direct/new/`);
    expect(listPeople(dir)[0]!.instagram?.threadId).toBe("777888999");
  });

  it("replaces stored thread evidence only after the profile Message action opens a new thread", async () => {
    upsertPerson(dir, { name: "Lasha", instagram: { username: "lasha_b", threadId: "111" } });
    const { chrome, setUrl } = makeChrome();
    chrome.click.mockImplementation(async (selector: string) => {
      if (selector === 'text="Message"') { setUrl(`${BASE}/direct/t/222333444/`); return { ok: true }; }
      return { ok: false, reason: "no matches" };
    });
    chrome.readPage.mockResolvedValue({ ok: true, text: PROFILE_TEXT });

    const res = await settle(() => openThread(depsWith(chrome), "Lasha"));
    expect(res.ok).toBe(true);
    expect(res.threadId).toBe("222333444");
    expect(res.detail).toContain("verified profile");
    expect(chrome.navigate.mock.calls.map((c) => c[0])).toEqual([
      `${BASE}/lasha_b/`,
    ]);
    expect(chrome.navigate).not.toHaveBeenCalledWith(`${BASE}/direct/t/111/`);
    expect(listPeople(dir)[0]!.instagram).toEqual({ username: "lasha_b", threadId: "222333444" });
  });

  it("auto-creates a person when the unknown query looks like a username", async () => {
    const { chrome, setUrl } = makeChrome();
    chrome.click.mockImplementation(async (selector: string) => {
      if (selector === 'text="Message"') { setUrl(`${BASE}/direct/t/999888777/`); return { ok: true }; }
      return { ok: false, reason: "no matches" };
    });
    const res = await settle(() => openThread(depsWith(chrome), "Cool.User_99"));
    expect(res.ok).toBe(true);
    expect(res.threadId).toBe("999888777");
    const people = listPeople(dir);
    expect(people).toHaveLength(1);
    expect(people[0]!.name).toBe("Cool.User_99");
    expect(people[0]!.instagram?.username).toBe("cool.user_99");
    expect(people[0]!.instagram?.threadId).toBe("999888777");
    expect(chrome.navigate).toHaveBeenCalledWith(`${BASE}/cool.user_99/`);
  });

  it("uses the people-map username exactly for the profile-to-Message route", async () => {
    upsertPerson(dir, { name: "Princi", aliases: ["Prince"], instagram: { username: "_princi150" } });
    const { chrome, setUrl } = makeChrome();
    chrome.readPage.mockResolvedValue({ ok: true, text: "_princi150\nMessage" });
    chrome.click.mockImplementation(async (selector: string) => {
      if (selector === 'text="Message"') {
        setUrl(`${BASE}/direct/t/150150/`);
        return { ok: true };
      }
      return { ok: false, reason: "no matches" };
    });

    const res = await settle(() => openThread(depsWith(chrome), "Prince"));

    expect(res.ok).toBe(true);
    expect(res.threadId).toBe("150150");
    expect(chrome.navigate.mock.calls.map((call) => call[0])).toEqual([
      "https://www.instagram.com/_princi150/",
    ]);
    expect(chrome.click).toHaveBeenCalledWith('text="Message"');
  });

  it("accepts Instagram's profile message drawer without requiring a direct-thread URL", async () => {
    upsertPerson(dir, { name: "Princi", instagram: { username: "_princi150", threadId: "old-evidence" } });
    const { chrome } = makeChrome();
    chrome.readPage.mockResolvedValue({ ok: true, text: "_princi150\nMessage" });
    chrome.click.mockImplementation(async (selector: string) => (
      selector === 'text="Message"' ? { ok: true } : { ok: false, reason: "no matches" }
    ));
    chrome.snapshot.mockResolvedValue({ ok: true, text: PROFILE_MESSAGE_DRAWER });

    const res = await settle(() => openThread(depsWith(chrome), "Princi"));

    expect(res.ok).toBe(true);
    expect(res.threadId).toBeUndefined();
    expect(res.detail).toContain("verified profile message drawer @_princi150");
    expect(chrome.url()).toBe(`${BASE}/_princi150/`);
    expect(chrome.navigate.mock.calls.map((call) => call[0])).toEqual([`${BASE}/_princi150/`]);
    expect(listPeople(dir)[0]?.instagram?.threadId).toBe("old-evidence");
  });

  it("asks for the person when an unknown query does not look like a username", async () => {
    const { chrome } = makeChrome();
    const res = await settle(() => openThread(depsWith(chrome), "that guy from the gym"));
    expect(res.ok).toBe(false);
    expect(res.needs).toBe("person");
    expect(res.detail).toContain("I don't know");
    expect(res.detail).toContain("that guy from the gym");
  });

  it("asks for the username when the person is known but has none on file", async () => {
    upsertPerson(dir, { name: "Guram" });
    const { chrome } = makeChrome();
    const res = await settle(() => openThread(depsWith(chrome), "Guram"));
    expect(res.ok).toBe(false);
    expect(res.needs).toBe("username");
    expect(res.detail).toContain("Guram");
  });

  it("does not trust a learned thread when the people-map username is missing", async () => {
    upsertPerson(dir, { name: "Guram", instagram: { threadId: "123456" } });
    const { chrome } = makeChrome();
    const res = await settle(() => openThread(depsWith(chrome), "Guram"));
    expect(res.ok).toBe(false);
    expect(res.needs).toBe("username");
    expect(chrome.navigate).not.toHaveBeenCalled();
  });

  it("flags a wrong username when the profile page is unavailable", async () => {
    upsertPerson(dir, { name: "Ghost", instagram: { username: "ghost_user_404" } });
    const { chrome } = makeChrome();
    chrome.readPage.mockResolvedValue({ ok: true, text: "Sorry, this page isn't available." });
    const res = await settle(() => openThread(depsWith(chrome), "Ghost"));
    expect(res.ok).toBe(false);
    expect(res.needs).toBe("username");
    expect(res.detail).toContain("@ghost_user_404");
  });

  it("reports login from the requested profile without detouring through the inbox", async () => {
    upsertPerson(dir, { name: "Princi", instagram: { username: "_princi150" } });
    const { chrome, setUrl } = makeChrome();
    chrome.navigate.mockImplementation(async () => {
      setUrl(`${BASE}/accounts/login/?next=%2F_princi150%2F`);
      return { ok: true };
    });
    chrome.readPage.mockResolvedValue({ ok: true, text: LOGIN_WALL_TEXT });

    const res = await settle(() => openThread(depsWith(chrome), "Princi"));

    expect(res.ok).toBe(false);
    expect(res.needs).toBe("login");
    expect(chrome.navigate.mock.calls.map((call) => call[0])).toEqual([
      `${BASE}/_princi150/`,
    ]);
  });

  it("stops on the exact profile when Message is unavailable instead of searching the inbox", async () => {
    upsertPerson(dir, { name: "Lasha Beridze", instagram: { username: "lasha_b" } });
    const { chrome } = makeChrome();
    chrome.readPage.mockResolvedValue({ ok: true, text: PROFILE_TEXT });

    const res = await settle(() => openThread(depsWith(chrome), "Lasha Beridze"));
    expect(res.ok).toBe(false);
    expect(res.detail).toContain("verified profile @lasha_b");
    expect(res.detail).toContain("No inbox search");
    expect(chrome.navigate.mock.calls.map((c) => c[0])).toEqual([`${BASE}/lasha_b/`]);
    expect(chrome.type).not.toHaveBeenCalled();
  });

  it("refuses to click Message after Instagram redirects to a different profile", async () => {
    upsertPerson(dir, { name: "Princi", instagram: { username: "_princi150" } });
    const { chrome, setUrl } = makeChrome();
    chrome.navigate.mockImplementation(async () => {
      setUrl(`${BASE}/wrong_person/`);
      return { ok: true };
    });
    chrome.readPage.mockResolvedValue({ ok: true, text: "wrong_person\nMessage" });
    const res = await settle(() => openThread(depsWith(chrome), "Princi"));
    expect(res.ok).toBe(false);
    expect(res.needs).toBe("username");
    expect(res.detail).toContain("exact saved profile @_princi150");
    expect(chrome.click).not.toHaveBeenCalledWith('text="Message"');
  });
});

// ── sendDm ───────────────────────────────────────────────────────────────────

const SNAPSHOT_WITH_COMPOSER = [
  "- banner:",
  '  - textbox "Search" [ref=e12]',
  "- main:",
  '  - textbox "Message" [ref=e42]',
  '  - button "Send" [ref=e57]',
].join("\n");

describe("sendDm", () => {
  const MSG = "hey, dinner at 9?";

  function chatSetup() {
    upsertPerson(dir, { name: "Lasha", instagram: { username: "lasha_b", threadId: "424242" } });
    const made = makeChrome();
    made.chrome.click.mockImplementation(async (selector: string) => {
      if (selector === 'text="Message"') {
        made.setUrl(`${BASE}/direct/t/424242/`);
        return { ok: true };
      }
      return { ok: false, reason: "no matches" };
    });
    made.chrome.snapshot.mockResolvedValue({ ok: true, text: SNAPSHOT_WITH_COMPOSER });
    return made;
  }

  it("types into the LAST snapshot textbox and verifies the message on the page", async () => {
    const { chrome } = chatSetup();
    chrome.readPage
      .mockResolvedValueOnce({ ok: true, text: PROFILE_TEXT }) // exact saved profile
      .mockResolvedValueOnce({ ok: true, text: `Lasha\nYou: ${MSG}\nSeen just now` }); // verification
    const res = await settle(() => sendDm(depsWith(chrome), "Lasha", MSG));
    expect(res.ok).toBe(true);
    expect(res.detail).toContain("sent to Lasha");
    expect(res.detail).toContain("verified on the page");
    expect(res.threadId).toBe("424242");
    // The footer composer (last textbox ref), not the search box.
    expect(chrome.type).toHaveBeenCalledTimes(1);
    expect(chrome.type).toHaveBeenCalledWith("aria-ref=e42", MSG);
    expect(chrome.press).toHaveBeenCalledWith("Enter");
    expect(chrome.navigate.mock.calls.map((c) => c[0])).toEqual([`${BASE}/lasha_b/`]);
    expect(chrome.navigate).not.toHaveBeenCalledWith(`${BASE}/direct/inbox/`);
    expect(chrome.navigate).not.toHaveBeenCalledWith(`${BASE}/direct/new/`);
  });

  it("sends to a saved _princi150 identity only through that exact profile", async () => {
    upsertPerson(dir, { name: "Princi", instagram: { username: "_princi150", threadId: "old-thread" } });
    const { chrome, setUrl } = makeChrome();
    chrome.click.mockImplementation(async (selector: string) => {
      if (selector === 'text="Message"') {
        setUrl(`${BASE}/direct/t/150150/`);
        return { ok: true };
      }
      return { ok: false, reason: "no matches" };
    });
    chrome.snapshot.mockResolvedValue({ ok: true, text: SNAPSHOT_WITH_COMPOSER });
    chrome.readPage
      .mockResolvedValueOnce({ ok: true, text: "_princi150\nMessage" })
      .mockResolvedValueOnce({ ok: true, text: `Princi\nYou: ${MSG}` });

    const res = await settle(() => sendDm(depsWith(chrome), "Princi", MSG));

    expect(res.ok).toBe(true);
    expect(chrome.navigate.mock.calls.map((call) => call[0])).toEqual([
      "https://www.instagram.com/_princi150/",
    ]);
    expect(chrome.click).toHaveBeenCalledWith('text="Message"');
    expect(chrome.type).toHaveBeenCalledWith("aria-ref=e42", MSG);
    expect(listPeople(dir)[0]?.instagram?.threadId).toBe("150150");
  });

  it("types and verifies inside the profile message drawer while retaining the profile URL", async () => {
    upsertPerson(dir, { name: "Princi", instagram: { username: "_princi150" } });
    const { chrome } = makeChrome();
    chrome.click.mockImplementation(async (selector: string) => (
      selector === 'text="Message"' ? { ok: true } : { ok: false, reason: "no matches" }
    ));
    chrome.snapshot.mockResolvedValue({ ok: true, text: PROFILE_MESSAGE_DRAWER });
    chrome.readPage
      .mockResolvedValueOnce({ ok: true, text: "_princi150\nMessage" })
      .mockResolvedValueOnce({ ok: true, text: `Princi\nYou: ${MSG}` });

    const res = await settle(() => sendDm(depsWith(chrome), "Princi", MSG));

    expect(res.ok).toBe(true);
    expect(res.threadId).toBeUndefined();
    expect(chrome.url()).toBe(`${BASE}/_princi150/`);
    expect(chrome.type).toHaveBeenCalledWith("aria-ref=e42", MSG);
    expect(chrome.press).toHaveBeenCalledWith("Enter");
  });

  it("refuses to claim success when the message never appears in the chat", async () => {
    const { chrome } = chatSetup();
    chrome.readPage
      .mockResolvedValueOnce({ ok: true, text: PROFILE_TEXT })
      .mockResolvedValueOnce({ ok: true, text: "Lasha\nYou: an older message\nSeen" });
    const res = await settle(() => sendDm(depsWith(chrome), "Lasha", MSG));
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/do not claim/i);
    expect(res.detail).toContain("chrome_snapshot");
  });

  it("rejects an empty message without touching the browser", async () => {
    const { chrome } = makeChrome();
    const res = await settle(() => sendDm(depsWith(chrome), "Lasha", "   "));
    expect(res).toEqual({ ok: false, detail: "empty message" });
    expect(chrome.navigate).not.toHaveBeenCalled();
  });

  it("returns needs person with the candidate list when the query is ambiguous", async () => {
    upsertPerson(dir, { name: "Lasha Beridze", instagram: { username: "lashab" } });
    upsertPerson(dir, { name: "Lasha Kapanadze", instagram: { username: "lashak" } });
    const { chrome } = makeChrome();
    const res = await settle(() => sendDm(depsWith(chrome), "Lasha", MSG));
    expect(res.ok).toBe(false);
    expect(res.needs).toBe("person");
    expect(res.detail).toContain("ambiguous");
    expect(res.detail).toContain("Lasha Beridze");
    expect(res.detail).toContain("Lasha Kapanadze");
    expect(res.detail).toContain("@lashab");
    expect(res.detail).toContain("@lashak");
  });
});
