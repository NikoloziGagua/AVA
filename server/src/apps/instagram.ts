import type { Chrome } from "../tools/chrome.js";
import { resolvePerson, upsertPerson, setAppField, type Person } from "./people.js";

// The Instagram module — deterministic workflows on the browser layer, built
// from the live debugging sessions of 2026-07-03. Design rules:
//  - FAST PATH FIRST: a learned thread id is one navigation
//    (instagram.com/direct/t/<id>/) — no search, no clicking through results.
//  - EVERY edge case is a STATE, not an exception: logged out, 2FA checkpoint,
//    unknown person, ambiguous person, dead thread id, missing composer. Each
//    returns `needs` + a human `detail` so Ava can ask Sir for exactly the
//    missing thing (credentials, a code, a username) and retry.
//  - Verify what matters: a send is only reported sent after the message text
//    is observed on the page.

export type IgDeps = { chrome: Chrome; memoryDir: string };

export type IgNeed =
  | "login"        // logged out — Sir must provide credentials or log in in Ava's window
  | "code"         // 2FA / suspicious-login checkpoint — Sir must provide the code
  | "person"       // unknown or ambiguous person — Sir must clarify (candidates listed)
  | "username"     // person known but no instagram username on file
  | "manual";      // something only a human can resolve (captcha, ban page)

export type IgResult = {
  ok: boolean;
  detail: string;
  needs?: IgNeed;
  threadId?: string;
};

const BASE = "https://www.instagram.com";

// ── page-state detection ─────────────────────────────────────────────────────

export function detectState(pageText: string, url: string): "in" | "wall" | "checkpoint" | "challenge" | "unknown" {
  // URL is the strong signal — page TEXT alone is treacherous: a friend's DM
  // preview saying "forgot password?" or "enter the code" must not convince
  // Ava she's logged out (adversarial review 2026-07-03).
  const t = pageText.slice(0, 4000);
  const checkpointText = /two[- ]factor|security code|code we sent|confirm it's you|suspicious login/i.test(t);
  if (/\/challenge\//.test(url)) return "challenge";
  if (/\/two_factor|\/login\/two_factor/.test(url)) return "checkpoint";
  // The 2FA step often lives under /accounts/login — checkpoint text there
  // means "code needed", not "wrong password".
  if (/\/accounts\/login/.test(url)) return checkpointText ? "checkpoint" : "wall";
  if (!pageText) return "unknown";
  // Inside the DM UI, previews are arbitrary content — trust only the URL there.
  if (/\/direct\//.test(url)) return "in";
  if (checkpointText) return "checkpoint";
  // A real login wall shows the whole trio, not a stray phrase.
  if (/Log in/i.test(t) && /Sign up/i.test(t) && /Forgot password/i.test(t)) return "wall";
  return "in";
}

async function pageState(chrome: Chrome): Promise<{ state: ReturnType<typeof detectState>; text: string }> {
  const r = await chrome.readPage();
  const text = r.ok ? (r.text ?? "") : "";
  return { state: detectState(text, chrome.url()), text };
}

/** Best-effort dismissal of Instagram's recurring nag dialogs. Never throws. */
export async function dismissPopups(chrome: Chrome): Promise<void> {
  for (const label of ["Not now", "Not Now", "Cancel"]) {
    try {
      const r = await chrome.click(`text=${label}`);
      if (!r.ok) continue;
      await sleep(400);
    } catch { /* best-effort */ }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Try selectors in order until one types successfully. Modern IG composers
 *  are contenteditables whose textbox role exists only in the a11y tree, so
 *  the role engine goes first and raw CSS is the fallback. */
async function typeFirst(
  chrome: Chrome, selectors: string[], text: string,
): Promise<{ ok: boolean; reason?: string; used?: string }> {
  const reasons: string[] = [];
  for (const sel of selectors) {
    const r = await chrome.type(sel, text);
    if (r.ok) return { ok: true, used: sel };
    reasons.push(`${sel}: ${r.reason}`);
  }
  return { ok: false, reason: reasons.join(" | ").slice(0, 300) };
}

// ── login ────────────────────────────────────────────────────────────────────

export async function ensureReady(deps: IgDeps): Promise<IgResult> {
  const nav = await deps.chrome.navigate(`${BASE}/direct/inbox/`);
  if (!nav.ok) return { ok: false, detail: `couldn't reach Instagram: ${nav.reason}` };
  await sleep(800);
  await dismissPopups(deps.chrome);
  // A cold browser renders nothing for several seconds — poll instead of
  // judging a blank page (live failure 2026-07-04: first run after a browser
  // boot read empty text at +800ms and bailed).
  let state: ReturnType<typeof detectState> = "unknown";
  for (let i = 0; i < 5 && state === "unknown"; i++) {
    if (i > 0) await sleep(1300);
    ({ state } = await pageState(deps.chrome));
  }
  if (state === "in") return { ok: true, detail: "logged in, inbox open" };
  if (state === "unknown") return { ok: false, detail: "Instagram page didn't render (stayed blank ~6s) — check the network/browser and retry." };
  if (state === "checkpoint") {
    return { ok: false, needs: "code", detail: "Instagram is asking for a verification code (2FA/suspicious-login check). Ask Sir for the code, then call instagram_submit_code." };
  }
  if (state === "challenge") {
    return { ok: false, needs: "manual", detail: "Instagram raised a challenge page (captcha/verification) that needs a human. Ask Sir to complete it in my browser window." };
  }
  return {
    ok: false, needs: "login",
    detail: "Not logged in to Instagram in my browser. Ask Sir to either (a) give me the username and password so I can log in (instagram_login), or (b) log in himself in my browser window — one time, it persists.",
  };
}

export async function login(deps: IgDeps, creds: { username: string; password: string }): Promise<IgResult> {
  const nav = await deps.chrome.navigate(`${BASE}/accounts/login/`);
  if (!nav.ok) return { ok: false, detail: `couldn't open the login page: ${nav.reason}` };
  await sleep(800);
  const u = await deps.chrome.type('input[name="username"]', creds.username);
  if (!u.ok) return { ok: false, detail: `couldn't find the username field: ${u.reason}` };
  const p = await deps.chrome.type('input[name="password"]', creds.password);
  if (!p.ok) return { ok: false, detail: `couldn't find the password field: ${p.reason}` };
  const s = await deps.chrome.click('button[type="submit"]');
  if (!s.ok) return { ok: false, detail: `couldn't click Log in: ${s.reason}` };
  await sleep(3500);
  await dismissPopups(deps.chrome);
  const { state, text } = await pageState(deps.chrome);
  if (state === "checkpoint") {
    return { ok: false, needs: "code", detail: "Credentials accepted but Instagram wants a verification code. Ask Sir for it, then instagram_submit_code." };
  }
  if (state === "wall") {
    const wrong = /password was incorrect|couldn't find your account|incorrect username/i.test(text);
    return { ok: false, needs: "login", detail: wrong ? "Instagram rejected those credentials (wrong username or password). Ask Sir to re-check them." : "Still on the login page — the form may have changed. Ask Sir to log in in my browser window instead." };
  }
  if (state === "challenge") {
    return { ok: false, needs: "manual", detail: "Login hit a captcha/challenge page — Sir needs to complete it in my browser window." };
  }
  return { ok: true, detail: "Logged in to Instagram." };
}

export async function submitCode(deps: IgDeps, code: string): Promise<IgResult> {
  const r = await deps.chrome.type('input[name="verificationCode"], input[autocomplete="one-time-code"], input[type="tel"], input[type="text"]', code.trim());
  if (!r.ok) return { ok: false, detail: `couldn't find the code field: ${r.reason}` };
  const c = await deps.chrome.click('button[type="submit"], text=Confirm, text=Submit, text=Continue');
  if (!c.ok) await deps.chrome.press("Enter");
  await sleep(3000);
  await dismissPopups(deps.chrome);
  const { state } = await pageState(deps.chrome);
  return state === "in"
    ? { ok: true, detail: "Code accepted — logged in." }
    : { ok: false, needs: state === "checkpoint" ? "code" : "manual", detail: "Instagram didn't accept that code (or wants another step). Ask Sir to double-check." };
}

// ── people plumbing ──────────────────────────────────────────────────────────

function resolveIg(deps: IgDeps, personQuery: string): { person?: Person; transient?: boolean; result?: IgResult } {
  const { person, candidates } = resolvePerson(deps.memoryDir, personQuery);
  if (person) {
    if (!person.instagram?.username && !person.instagram?.threadId) {
      return { result: { ok: false, needs: "username", detail: `I know ${person.name} but not their Instagram username. Ask Sir for it, save it with person_remember, then retry.` } };
    }
    return { person };
  }
  if (candidates.length > 1) {
    return { result: { ok: false, needs: "person", detail: `"${personQuery}" is ambiguous — candidates: ${candidates.map((c) => `${c.name}${c.instagram?.username ? ` (@${c.instagram.username})` : ""}`).join(", ")}. Ask Sir which one.` } };
  }
  // Unknown person. Treat the query as a raw handle ONLY when it actually
  // reads like one (@-prefixed, or contains ./_/digits): plain words like
  // "mom" or "lasha" are NICKNAMES, and blindly DMing @mom sends Sir's
  // private message to a stranger (critical finding, adversarial review
  // 2026-07-03). Even a handle-looking query is NOT saved to the people map
  // until a thread actually opens — a typo must not poison future resolution.
  const q = personQuery.trim();
  const handleLike = q.startsWith("@") || (/^[a-z0-9._]{2,30}$/i.test(q) && /[._0-9]/.test(q));
  if (handleLike) {
    const username = q.toLowerCase().replace(/^@/, "");
    const transient: Person = {
      id: "", name: q.replace(/^@/, ""), aliases: [], updated: "",
      instagram: { username },
    };
    return { person: transient, transient: true };
  }
  return { result: { ok: false, needs: "person", detail: `I don't know "${personQuery}" yet, and I won't guess a username for a plain name — that risks messaging a stranger. Ask Sir for their exact Instagram username (person_remember it), then retry.` } };
}

// ── threads ──────────────────────────────────────────────────────────────────

const threadIdFromUrl = (url: string): string | null =>
  /\/direct\/t\/(\d+)/.exec(url)?.[1] ?? null;

/**
 * Open a profile without entering or sending a DM. Known people and explicit
 * @handles navigate directly. An unknown plain name opens Instagram's search
 * results instead of blocking on an empty people map or guessing an identity.
 */
export async function openProfile(deps: IgDeps, personQuery: string): Promise<IgResult> {
  const ready = await ensureReady(deps);
  if (!ready.ok) return ready;

  const query = personQuery.trim();
  if (!query) return { ok: false, needs: "person", detail: "A name or Instagram username is required." };

  const { person, candidates } = resolvePerson(deps.memoryDir, query);
  if (candidates.length > 1) {
    return {
      ok: false,
      needs: "person",
      detail: `"${query}" is ambiguous — candidates: ${candidates.map((p) => p.name).join(", ")}. Ask Sir which one.`,
    };
  }

  const knownUsername = person?.instagram?.username?.replace(/^@/, "");
  const explicitUsername = query.startsWith("@") ? query.slice(1) : null;
  const username = knownUsername || explicitUsername;
  if (username) {
    const nav = await deps.chrome.navigate(`${BASE}/${encodeURIComponent(username)}/`);
    if (!nav.ok) return { ok: false, detail: `couldn't open @${username}'s profile: ${nav.reason}` };
    await sleep(1000);
    const read = await deps.chrome.readPage();
    if (read.ok && /Sorry, this page isn't available/i.test(read.text ?? "")) {
      return { ok: false, needs: "username", detail: `@${username} is unavailable. Ask Sir for the exact username.` };
    }
    return { ok: true, detail: `Instagram profile @${username} open; no message sent` };
  }

  const searchUrl = `${BASE}/explore/search/keyword/?q=${encodeURIComponent(query)}`;
  const nav = await deps.chrome.navigate(searchUrl);
  if (!nav.ok) return { ok: false, detail: `couldn't search Instagram for "${query}": ${nav.reason}` };
  await sleep(1000);
  return {
    ok: true,
    detail:
      `Instagram profile search for "${query}" is open. I did not guess an account or send anything; ` +
      "give me the @username to open an exact profile.",
  };
}

/** IG's SPA navigates on its own schedule — poll for the thread URL instead
 *  of trusting one fixed sleep. */
async function waitForThreadUrl(chrome: Chrome, ms = 6000): Promise<string | null> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const id = threadIdFromUrl(chrome.url());
    if (id) return id;
    await sleep(500);
  }
  return null;
}

/** Compose-dialog route: works for anyone searchable, INCLUDING Sir himself
 *  (your own profile has no Message button — the self-DM trap). Every click
 *  is ref-based from the live snapshot — text selectors are ambiguous here
 *  (the same username appears in the left rail), and nag dialogs stack on
 *  top of the compose dialog. */
async function composeTo(deps: IgDeps, username: string): Promise<string | null> {
  await deps.chrome.navigate(`${BASE}/direct/new/`);
  await sleep(1500);
  await dismissPopups(deps.chrome);
  const snap1 = await deps.chrome.snapshot();
  const searchRef = /textbox[^\n]*?\[ref=(e\d+)\]/.exec(snap1.text ?? "")?.[1];
  if (!searchRef) return null;
  const typed = await deps.chrome.type(`aria-ref=${searchRef}`, username);
  if (!typed.ok) return null;
  await sleep(2000);
  // Result rows render below the search box — take the LAST snapshot line
  // mentioning the username (tree order puts dialog content after the rail).
  const snap2 = await deps.chrome.snapshot();
  const lines = (snap2.text ?? "").split("\n");
  const uname = username.toLowerCase();
  // EXACT-token match: "nika_gagua_" must not click "nika_gagua_2"'s row
  // (identity is the one thing a messenger must never fuzz).
  const tokenRe = new RegExp(`(^|[^a-z0-9._])${uname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9._])`, "i");
  const rowRefs = lines
    .filter((l) => tokenRe.test(l))
    .map((l) => /\[ref=(e\d+)\]/.exec(l)?.[1])
    .filter((r): r is string => !!r);
  const rowRef = rowRefs[rowRefs.length - 1];
  if (!rowRef) return null;
  const picked = await deps.chrome.click(`aria-ref=${rowRef}`);
  if (!picked.ok) return null;
  await sleep(800);
  // The confirm button ("Chat" / "Next") — again by ref.
  const snap3 = await deps.chrome.snapshot();
  const goRef = [...(snap3.text ?? "").matchAll(/button "(?:Chat|Next)"[^\n]*?\[ref=(e\d+)\]/g)].map((m) => m[1]!).pop();
  if (goRef) await deps.chrome.click(`aria-ref=${goRef}`);
  else await deps.chrome.press("Enter");
  return waitForThreadUrl(deps.chrome);
}

export async function openThread(deps: IgDeps, personQuery: string): Promise<IgResult & { person?: Person }> {
  const ready = await ensureReady(deps);
  if (!ready.ok) return ready;
  const { person, transient, result } = resolveIg(deps, personQuery);
  if (result) return result;
  const p = person!;

  // Persist identity + learned thread ONLY on success: a transient (guessed)
  // person must never enter the people map off a failed or unverified flow.
  const learn = (id: string): Person => {
    const saved = transient
      ? upsertPerson(deps.memoryDir, { name: p.name, instagram: { username: p.instagram!.username!, threadId: id } })
      : p;
    setAppField(deps.memoryDir, saved.id, "instagram", "threadId", id);
    return saved;
  };

  // FAST PATH: learned thread id — one navigation. IG redirects dead threads
  // only after hydration (2-6s), so poll rather than peeking at 1.2s.
  if (p.instagram?.threadId) {
    const nav = await deps.chrome.navigate(`${BASE}/direct/t/${p.instagram.threadId}/`);
    const id = nav.ok ? await waitForThreadUrl(deps.chrome, 5000) : null;
    if (id === p.instagram.threadId) {
      return { ok: true, detail: `chat with ${p.name} open (fast path)`, threadId: id, person: p };
    }
    // Before declaring the thread dead, rule out a session problem — a login
    // wall mid-flow must NOT erase a perfectly good learned thread.
    const { state } = await pageState(deps.chrome);
    if (state !== "in") {
      const again = await ensureReady(deps);
      if (!again.ok) return again;
    } else {
      // Genuinely dead/moved — self-heal: forget it, rediscover below.
      setAppField(deps.memoryDir, p.id, "instagram", "threadId", "");
    }
  }

  // DISCOVERY: profile → Message button → thread URL. More stable than the
  // "new message" search dialog (learned live: search-result clicks are flaky).
  const username = p.instagram!.username!;
  const nav = await deps.chrome.navigate(`${BASE}/${username}/`);
  if (!nav.ok) return { ok: false, detail: `couldn't open @${username}'s profile: ${nav.reason}` };
  await sleep(1200);
  await dismissPopups(deps.chrome);
  const read = await deps.chrome.readPage();
  if (read.ok && /Sorry, this page isn't available/i.test(read.text ?? "")) {
    return { ok: false, needs: "username", detail: `@${username} doesn't exist (profile page unavailable). The username on file for ${p.name} is wrong — ask Sir for the right one.` };
  }
  // Mid-flow session check: the profile page is outside /direct/, so a wall
  // here is real (not a preview false-positive).
  const profState = detectState(read.ok ? (read.text ?? "") : "", deps.chrome.url());
  if (profState !== "in") {
    const again = await ensureReady(deps);
    if (!again.ok) return again;
    await deps.chrome.navigate(`${BASE}/${username}/`);
    await sleep(1200);
  }

  // EXACT text match: unquoted text=Message substring-matches the left-nav
  // "Messages" link and silently dumps us on the inbox (live bug 2026-07-03).
  const msg = await deps.chrome.click('text="Message"');
  let id: string | null = null;
  if (msg.ok) id = await waitForThreadUrl(deps.chrome);
  if (!id) {
    // No Message button (own profile / restricted DMs) or the click didn't
    // land on a thread — the compose dialog covers both, including self-DM.
    id = await composeTo(deps, username);
  }
  if (id) {
    const saved = learn(id);
    return { ok: true, detail: `chat with ${saved.name} open (thread learned — next time is instant)`, threadId: id, person: saved };
  }
  return {
    ok: false,
    detail: `couldn't reach a DM thread with @${username} (profile Message button: ${msg.ok ? "clicked but no thread URL" : msg.reason}; compose dialog also failed) — at ${deps.chrome.url()}. chrome_snapshot to see the page.`,
  };
}

// ── messaging ────────────────────────────────────────────────────────────────

export async function sendDm(deps: IgDeps, personQuery: string, text: string): Promise<IgResult> {
  if (!text.trim()) return { ok: false, detail: "empty message" };
  const opened = await openThread(deps, personQuery);
  if (!opened.ok) return opened;

  // The composer's only reliable address is its a11y ref: Chromium's AX tree
  // shows it as a (often nameless) textbox even when the DOM exposes no
  // contenteditable/role attributes Playwright CSS or role= selectors can see
  // (verified live 2026-07-03: every CSS strategy missed; aria-ref always
  // landed). Snapshot → take the LAST textbox on the page (the footer
  // composer; earlier ones are search boxes) → type by ref. One retry for
  // slow hydration, then CSS as the long-shot fallback.
  let box: { ok: boolean; reason?: string } = { ok: false, reason: "no snapshot yet" };
  for (let attempt = 0; attempt < 2 && !box.ok; attempt++) {
    if (attempt > 0) await sleep(1500);
    const snap = await deps.chrome.snapshot();
    const refs = [...(snap.text ?? "").matchAll(/textbox[^\n]*?\[ref=(e\d+)\]/g)].map((m) => m[1]!);
    const composer = refs[refs.length - 1];
    if (!composer) { box = { ok: false, reason: "no textbox in the page snapshot" }; continue; }
    box = await deps.chrome.type(`aria-ref=${composer}`, text);
  }
  if (!box.ok) {
    box = await typeFirst(deps.chrome, [
      'div[contenteditable="true"][aria-label*="essage"]',
      'div[contenteditable="true"]',
      'textarea[placeholder*="essage"]',
    ], text);
  }
  if (!box.ok) {
    return { ok: false, detail: `chat open but couldn't find the message box (${box.reason}) — chrome_snapshot to locate it.` };
  }
  const enter = await deps.chrome.press("Enter");
  if (!enter.ok) return { ok: false, detail: `typed but couldn't send: ${enter.reason}` };
  await sleep(1800);

  // Verification that can actually FAIL (the naive tail-includes check was
  // vacuously true: the unsent draft sits in the composer, whose text lives in
  // the same innerText — adversarial review 2026-07-03):
  //  1. explicit failure markers fail immediately;
  //  2. the text must appear on the page (emoji stripped — innerText renders
  //     IG emoji as <img>, invisible to text matching);
  //  3. the composer must be EMPTY — text still in the composer means Enter
  //     did not send, no matter what the tail says.
  const read = await deps.chrome.readPage();
  const tail = (read.ok ? (read.text ?? "") : "").slice(-2500);
  if (/couldn'?t send|failed to send|message not sent|try again/i.test(tail)) {
    return { ok: false, detail: "Instagram reports the message FAILED to send — do not claim delivery. Retry or chrome_snapshot to inspect." };
  }
  const snippet = text.slice(0, 60).replace(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{27BF}\u{FE0F}\u{200D}]/gu, "").trim();
  const inTail = snippet.length >= 3 ? tail.includes(snippet) : true;
  const snap = await deps.chrome.snapshot();
  const boxBlocks = [...(snap.text ?? "").matchAll(/textbox[^\n]*\[ref=e\d+\][^\n]*(?:\n[ \t]{2,}[^\n]*){0,3}/g)].map((m) => m[0]);
  const composerHolds = snippet.length >= 3 && !!boxBlocks.length
    && boxBlocks[boxBlocks.length - 1]!.includes(snippet);
  if (composerHolds) {
    return { ok: false, detail: "the message is still sitting in the composer (Enter didn't send it) — press Enter again or click Send; do NOT claim it was sent." };
  }
  if (!inTail) {
    return { ok: false, detail: "typed and pressed Enter, but the message does NOT appear in the chat — do not claim it was sent. chrome_snapshot to inspect." };
  }
  const who = opened.person?.name ?? personQuery;
  return { ok: true, detail: `sent to ${who} and verified on the page`, threadId: opened.threadId };
}

/** Read the tail of a conversation (for "what did Lasha reply?"). */
export async function readThread(deps: IgDeps, personQuery: string): Promise<IgResult & { text?: string }> {
  const opened = await openThread(deps, personQuery);
  if (!opened.ok) return opened;
  const read = await deps.chrome.readPage();
  if (!read.ok) return { ok: false, detail: `chat open but couldn't read it: ${read.reason}` };
  return { ok: true, detail: `conversation with ${opened.person?.name ?? personQuery}`, text: (read.text ?? "").slice(-2000), threadId: opened.threadId };
}
