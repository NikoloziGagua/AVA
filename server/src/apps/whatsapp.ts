import type { Chrome } from "../tools/chrome.js";
import { resolvePerson, upsertPerson, setAppField, type Person } from "./people.js";

// The WhatsApp module — deterministic workflows on the browser layer, modeled
// on the Instagram module. Design rules:
//  - WhatsApp Web has no password login: the ONLY way in is Sir scanning the
//    QR code in my browser window with his phone (Linked devices). So the
//    logged-out state is a single `needs: "qr"` with instructions for Sir.
//  - EVERY edge case is a STATE, not an exception: QR screen, still loading,
//    unknown person, ambiguous person, no result in search, missing composer.
//    Each returns `needs` + a human `detail` so Ava can ask Sir for exactly
//    the missing thing (a scan, a display name, a phone number) and retry.
//  - Verify what matters: a chat is only "open" after the conversation header
//    shows the person's name; a send is only reported sent after the message
//    text is observed on the page.

export type WaWaits = { ready: number; search: number; result: number; send: number };

export type WaDeps = {
  chrome: Chrome;
  memoryDir: string;
  /** Test hook: override the settle delays (milliseconds). */
  waits?: Partial<WaWaits>;
};

export type WaNeed =
  | "qr"           // logged out — Sir must scan the QR code in Ava's browser window
  | "person"       // unknown or ambiguous person — Sir must clarify (candidates listed)
  | "username";    // person known but no WhatsApp display name or phone on file

export type WaResult = {
  ok: boolean;
  detail: string;
  needs?: WaNeed;
};

const BASE = "https://web.whatsapp.com";

const DEFAULT_WAITS: WaWaits = { ready: 2500, search: 1200, result: 1000, send: 1200 };

const waitsOf = (deps: WaDeps): WaWaits => ({ ...DEFAULT_WAITS, ...deps.waits });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── page-state detection ─────────────────────────────────────────────────────

export function detectWaState(pageText: string, url: string): "in" | "qr" | "loading" {
  const t = pageText.slice(0, 6000);
  // A chat preview can SAY "scan the QR code" — a message about QR codes must
  // not convince Ava the session is logged out. The QR verdict requires the
  // marker AND the absence of the logged-in chrome (search bar / Chats rail).
  const qrMarker = /use whatsapp on your computer|scan the qr|log into whatsapp web|link a device/i.test(t);
  const appMarker = /search or start a new chat|(^|\n)\s*chats\s*($|\n)/i.test(t);
  if (qrMarker && !appMarker) return "qr";
  if (/loading your chats/i.test(t) && !appMarker) return "loading";
  void url; // URL doesn't change between states on web.whatsapp.com — text is the signal.
  return "in";
}

async function pageState(chrome: Chrome): Promise<{ state: ReturnType<typeof detectWaState>; text: string }> {
  const r = await chrome.readPage();
  const text = r.ok ? (r.text ?? "") : "";
  return { state: detectWaState(text, chrome.url()), text };
}

// ── readiness (QR link check) ────────────────────────────────────────────────

export async function ensureReady(deps: WaDeps): Promise<WaResult> {
  const w = waitsOf(deps);
  const nav = await deps.chrome.navigate(`${BASE}/`);
  if (!nav.ok) return { ok: false, detail: `couldn't reach WhatsApp Web: ${nav.reason}` };
  await sleep(w.ready);
  let { state } = await pageState(deps.chrome);
  if (state === "loading") {
    // Chats still syncing — give it one more settle window before judging.
    await sleep(w.ready);
    ({ state } = await pageState(deps.chrome));
  }
  if (state === "in") return { ok: true, detail: "WhatsApp Web is linked, chat list open" };
  if (state === "loading") {
    return { ok: false, detail: "WhatsApp Web is still loading the chats (\"Loading your chats\"). Wait a few seconds and retry — no action needed from Sir yet." };
  }
  return {
    ok: false, needs: "qr",
    detail: "WhatsApp Web is showing the QR login screen — I can't scan it myself. Ask Sir to link it in my browser window: on his phone open WhatsApp > Settings > Linked devices > Link a device, then scan the QR code shown in my window. One time — the session persists.",
  };
}

// ── people plumbing ──────────────────────────────────────────────────────────

const phoneDigits = (s: string) => s.replace(/\D/g, "");
const looksLikePhone = (s: string) => /^[+\d][\d\s().-]*$/.test(s.trim()) && phoneDigits(s).length >= 7;

function resolveWa(deps: WaDeps, personQuery: string): { person?: Person; result?: WaResult } {
  const { person, candidates } = resolvePerson(deps.memoryDir, personQuery);
  if (person) {
    if (!person.whatsapp?.username && !person.whatsapp?.phone) {
      return { result: { ok: false, needs: "username", detail: `I know ${person.name} but not their WhatsApp identity. Ask Sir for the display name they appear under in WhatsApp (as shown in the chat list) or their phone number, save it with person_remember, then retry.` } };
    }
    return { person };
  }
  if (candidates.length > 1) {
    return { result: { ok: false, needs: "person", detail: `"${personQuery}" is ambiguous — candidates: ${candidates.map((c) => `${c.name}${c.whatsapp?.username ? ` (WA ${c.whatsapp.username})` : c.whatsapp?.phone ? ` (${c.whatsapp.phone})` : ""}`).join(", ")}. Ask Sir which one.` } };
  }
  // Unknown person: maybe the query IS a phone number — use it directly, and
  // let the open flow learn the display name afterwards.
  if (looksLikePhone(personQuery)) {
    const p = upsertPerson(deps.memoryDir, { name: personQuery.trim(), whatsapp: { phone: personQuery.trim() } });
    return { person: p };
  }
  return { result: { ok: false, needs: "person", detail: `I don't know "${personQuery}" yet. Ask Sir for their WhatsApp display name (as it appears in the chat list) or phone number, then person_remember it.` } };
}

// ── chat-list search ─────────────────────────────────────────────────────────

// The chat-list search box. WhatsApp Web has TWO contenteditables (search box
// + message composer) — the search box comes first in the DOM (left pane), so
// the generic selectors resolve to it when both exist.
const SEARCH_SELECTORS = [
  'div[contenteditable="true"][data-tab]',
  'div[role="textbox"][aria-label*="Search"]',
  'div[role="textbox"]',
];

async function typeInSearch(chrome: Chrome, text: string): Promise<{ ok: boolean; reason?: string }> {
  let lastReason = "no search selector matched";
  for (const sel of SEARCH_SELECTORS) {
    const c = await chrome.click(sel);
    if (!c.ok) { lastReason = c.reason ?? lastReason; continue; }
    const t = await chrome.type(sel, text);
    if (t.ok) return { ok: true };
    lastReason = t.reason ?? lastReason;
  }
  return { ok: false, reason: lastReason };
}

/**
 * Pull the contact's display name out of the search-results text when we only
 * know the phone. WhatsApp groups results under a "Contacts" heading; the
 * first real line after it is the display name of the matching contact.
 */
export function extractContactName(searchText: string, phone: string): string | null {
  const lines = searchText.split("\n").map((l) => l.trim());
  const idx = lines.findIndex((l) => /^contacts$/i.test(l));
  if (idx < 0) return null;
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (/^(chats|messages|groups)$/i.test(line)) break;         // next section — no contact found
    if (phoneDigits(line) === phoneDigits(phone) && phoneDigits(line).length > 0) continue; // the number itself, not a name
    return line;
  }
  return null;
}

// ── opening a chat ───────────────────────────────────────────────────────────

export async function openChat(deps: WaDeps, personQuery: string): Promise<WaResult & { person?: Person }> {
  const w = waitsOf(deps);
  const ready = await ensureReady(deps);
  if (!ready.ok) return ready;
  const { person, result } = resolveWa(deps, personQuery);
  if (result) return result;
  const p = person!;

  const searchTerm = p.whatsapp?.username || p.whatsapp?.phone || "";
  const typed = await typeInSearch(deps.chrome, searchTerm);
  if (!typed.ok) {
    return { ok: false, detail: `couldn't find the chat-list search box (${typed.reason}) — the layout may have changed; chrome_snapshot will show the controls.` };
  }
  await sleep(w.search);

  // When we only have a phone, read the search results and learn the display
  // name — that's what we click, and what we save for next time.
  let displayName = p.whatsapp?.username ?? null;
  const resolvedByPhone = !p.whatsapp?.username;
  if (!displayName) {
    const results = await deps.chrome.readPage();
    displayName = extractContactName(results.ok ? (results.text ?? "") : "", p.whatsapp?.phone ?? "");
  }
  const target = displayName ?? searchTerm;

  // Row selection by EXACT quoted accessible name from the a11y snapshot —
  // `text=` substring clicks hit the search box itself or a group whose title
  // merely CONTAINS the name ("Lasha & Nika trip") and the message then goes
  // to the wrong recipient (critical finding, adversarial review 2026-07-03).
  const snap = await deps.chrome.snapshot();
  const rowLines = (snap.text ?? "").split("\n").filter((l) => l.includes(`"${target}"`));
  const rowRef = rowLines
    .map((l) => /\[ref=(e\d+)\]/.exec(l)?.[1])
    .filter((r): r is string => !!r)
    .pop();
  if (!rowRef) {
    return {
      ok: false, needs: "username",
      detail: `searched WhatsApp for "${searchTerm}" but found no result named exactly "${target}". The display name or phone on file for ${p.name} may be wrong — ask Sir for the exact name shown in his WhatsApp chat list, save it with person_remember, then retry.`,
    };
  }
  const hit = await deps.chrome.click(`aria-ref=${rowRef}`);
  if (!hit.ok) {
    return { ok: false, detail: `found the "${target}" row but couldn't click it (${hit.reason}) — chrome_snapshot to inspect.` };
  }
  await sleep(w.result);

  // Header verification scoped to the CONVERSATION pane: the name must appear
  // in the snapshot's main region, not just anywhere on the page (the left
  // rail always contains it, which made the old check vacuously true).
  const snapAfter = await deps.chrome.snapshot();
  const afterLines = (snapAfter.text ?? "").split("\n");
  const mainIdx = afterLines.findIndex((l) => /-\s*(main|banner)\b/.test(l));
  const headerVerified = mainIdx >= 0
    ? afterLines.slice(mainIdx).some((l) => l.includes(`"${target}"`))
    : afterLines.some((l) => l.includes(`"${target}"`)); // no landmark — weak fallback
  if (!headerVerified) {
    return { ok: false, detail: `clicked the "${target}" row but the conversation pane doesn't show that name — do NOT send anything yet. chrome_snapshot to inspect what actually opened.` };
  }

  // Learned the display name from a phone-only contact — save it (the fast,
  // unambiguous search key for next time).
  if (resolvedByPhone && displayName) {
    setAppField(deps.memoryDir, p.id, "whatsapp", "username", displayName);
  }
  return { ok: true, detail: `chat with ${displayName ?? p.name} open, header verified`, person: p };
}

// ── messaging ────────────────────────────────────────────────────────────────

// The message composer — the SECOND contenteditable. Scope to the footer so we
// never type the message into the chat-list search box.
const COMPOSER_SELECTORS = [
  'footer div[contenteditable="true"]',
  'div[title="Type a message"]',
  'footer div[role="textbox"]',
];

export async function sendMessage(deps: WaDeps, personQuery: string, text: string): Promise<WaResult> {
  if (!text.trim()) return { ok: false, detail: "empty message" };
  const w = waitsOf(deps);
  const opened = await openChat(deps, personQuery);
  if (!opened.ok) return opened;

  let box: { ok: boolean; reason?: string } = { ok: false, reason: "no composer selector matched" };
  for (const sel of COMPOSER_SELECTORS) {
    box = await deps.chrome.type(sel, text);
    if (box.ok) break;
  }
  if (!box.ok) {
    return { ok: false, detail: `chat open but couldn't find the message composer (${box.reason}) — chrome_snapshot to locate it.` };
  }
  const enter = await deps.chrome.press("Enter");
  if (!enter.ok) return { ok: false, detail: `typed but couldn't send: ${enter.reason}` };
  await sleep(w.send);

  // Verification that can actually fail: emoji-stripped snippet must appear on
  // the page AND must have LEFT the composer (a draft still sitting in the
  // footer lives in the same innerText — the vacuous-pass trap).
  const read = await deps.chrome.readPage();
  const tail = (read.ok ? (read.text ?? "") : "").slice(-2500);
  const snippet = text.slice(0, 60).replace(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{27BF}\u{FE0F}\u{200D}]/gu, "").trim();
  const inTail = snippet.length >= 3 ? tail.includes(snippet) : true;
  const verifySnap = await deps.chrome.snapshot();
  const boxBlocks = [...(verifySnap.text ?? "").matchAll(/textbox[^\n]*\[ref=e\d+\][^\n]*(?:\n[ \t]{2,}[^\n]*){0,3}/g)].map((m) => m[0]);
  const composerHolds = snippet.length >= 3 && !!boxBlocks.length
    && boxBlocks[boxBlocks.length - 1]!.includes(snippet);
  if (composerHolds) {
    return { ok: false, detail: "the message is still in the composer (Enter didn't send) — press Enter again; do NOT claim it was sent." };
  }
  if (!inTail) {
    return { ok: false, detail: "typed and pressed Enter, but the message does NOT appear in the conversation — do not claim it was sent. chrome_snapshot to inspect." };
  }
  const who = opened.person?.name ?? personQuery;
  return { ok: true, detail: `sent to ${who} on WhatsApp and verified on the page` };
}

/** Read the tail of a conversation (for "what did Lasha reply on WhatsApp?"). */
export async function readChat(deps: WaDeps, personQuery: string): Promise<WaResult & { text?: string }> {
  const opened = await openChat(deps, personQuery);
  if (!opened.ok) return opened;
  const read = await deps.chrome.readPage();
  if (!read.ok) return { ok: false, detail: `chat open but couldn't read it: ${read.reason}` };
  return { ok: true, detail: `WhatsApp conversation with ${opened.person?.name ?? personQuery}`, text: (read.text ?? "").slice(-2000) };
}
