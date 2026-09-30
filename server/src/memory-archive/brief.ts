import { join } from "node:path";
import { readFile, writeFile } from "../memory/store.js";
import type { MemoryArchive } from "./archive.js";
import type { MemoryKind, MemoryRecord } from "./types.js";

// The Brief: the small, always-loaded part of memory (proposal Layer 0). It is
// rendered from the archive whenever memory changes and read from disk by the
// system prompt, so chat, action and voice all see the same text. It replaces
// the preferences and observations blocks when memory v2 is on.

export const BRIEF_FILE = "brief.md";
/** About 1,500 tokens: small enough to load on every turn, including voice. */
export const BRIEF_MAX_CHARS = 6_000;
const DAY_MS = 86_400_000;
const RECENT_DAYS = 14;
const PAST_DUE_DAYS = 3;

export function memoryV2Enabled(): boolean {
  return process.env.AVA_MEMORY_V2 === "on";
}

export function briefPath(memoryDir: string): string {
  return join(memoryDir, BRIEF_FILE);
}

/** The Brief as last written, or "" when memory v2 is off or nothing is stored. */
export function readBrief(memoryDir: string): string {
  return memoryV2Enabled() ? readFile(briefPath(memoryDir)) : "";
}

const SECTIONS: ReadonlyArray<{ kind: MemoryKind; title: string }> = [
  { kind: "fact", title: "About Niko" },
  { kind: "person", title: "People in his life" },
  { kind: "project", title: "Projects and current focus" },
  { kind: "decision", title: "Decisions he made" },
  { kind: "commitment", title: "Commitments and what's coming up" },
  { kind: "preference", title: "How he wants me to work" },
  { kind: "event", title: "Recent events" },
];

const DAY_FORMAT = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Dublin", day: "numeric", month: "short" });
const YEAR_FORMAT = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Dublin", year: "numeric" });
const TIME_FORMAT = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Dublin", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "24 Sep", or "24 Sep 2025" outside the current year (Dublin time). */
export function briefDay(ms: number, now: number): string {
  const day = DAY_FORMAT.format(ms).replace("Sept", "Sep");
  return YEAR_FORMAT.format(ms) === YEAR_FORMAT.format(now) ? day : `${day} ${YEAR_FORMAT.format(ms)}`;
}

function provenance(record: MemoryRecord): string {
  switch (record.speechAct) {
    case "stated": return "he said";
    case "decided": return "he decided";
    case "requested": return "he asked me to remember";
    case "discussed": return "we discussed; not his decision";
    case "inferred": return "my inference";
  }
}

function line(record: MemoryRecord, now: number): string {
  let due = "";
  if (record.dueAt !== null) {
    const when = `${briefDay(record.dueAt, now)} ${TIME_FORMAT.format(record.dueAt)}`;
    // A deadline passing is not the same as the thing being done.
    due = record.dueAt < now ? `; was due ${when}, whether it happened is unknown` : `; due ${when}`;
  }
  return `- ${record.text} (${provenance(record)}, ${briefDay(record.saidAt, now)}${due})`;
}

function belongs(record: MemoryRecord, now: number): boolean {
  if (!record.carry || record.status !== "active") return false;
  if (record.kind === "event") return now - record.saidAt <= RECENT_DAYS * DAY_MS;
  if (record.kind === "commitment" && record.dueAt !== null) return record.dueAt >= now - PAST_DUE_DAYS * DAY_MS;
  return true;
}

type Entry = { section: string; text: string; priority: number; order: number };

export function renderBrief(input: { current: MemoryRecord[]; ended: MemoryRecord[]; now: number; maxChars?: number }): string {
  const { now } = input;
  const maxChars = input.maxChars ?? BRIEF_MAX_CHARS;
  const entries: Entry[] = [];
  let order = 0;
  for (const { kind, title } of SECTIONS) {
    for (const record of input.current.filter((item) => item.kind === kind && belongs(item, now))) {
      // Trimming drops the least useful first: old events, then low confidence, then the oldest.
      const priority = (kind === "event" ? 0 : 10) + (record.confidence === "low" ? 0 : record.confidence === "medium" ? 3 : 5)
        + (kind === "preference" || kind === "fact" || kind === "person" ? 4 : 0);
      entries.push({ section: title, text: line(record, now), priority, order: order++ });
    }
  }
  const recent = input.ended
    .filter((record) => record.carry && record.validTo !== null && now - record.validTo <= RECENT_DAYS * DAY_MS)
    .filter((record) => record.kind !== "event");
  // What stopped being true is worth keeping in view, so an old version found
  // elsewhere isn't taken as current. An older version of a fact adds nothing
  // (its replacement is listed above); a replaced priority or decision does,
  // so the last two stay.
  const changed = [
    ...recent.filter((record) => !record.supersededById),
    ...recent.filter((record) => record.supersededById && (record.kind === "project" || record.kind === "decision")).slice(-2),
  ].sort((a, b) => a.validTo! - b.validTo!);
  for (const record of changed) {
    const how = record.supersededById ? "replaced since" : "no longer current";
    entries.push({
      section: "Changed recently (history, not current)",
      text: `- Until ${briefDay(record.validTo!, now)}: ${record.text} (${how})`,
      priority: 1,
      order: order++,
    });
  }
  const header = [
    "# Memory: what I know about Niko",
    "Things Niko told me, with the date he said them. Newer beats older, and the current conversation beats both.",
    "\"We discussed\" marks an idea, not his decision. For anything not listed here I search memory before saying I don't know.",
  ].join("\n");
  const render = (kept: Entry[], hidden: number): string => {
    const parts = [header];
    for (const section of [...SECTIONS.map((s) => s.title), "Changed recently (history, not current)"]) {
      const lines = kept.filter((entry) => entry.section === section).sort((a, b) => a.order - b.order);
      if (lines.length) parts.push(`## ${section}\n${lines.map((entry) => entry.text).join("\n")}`);
    }
    if (hidden) parts.push(`(${hidden} more ${hidden === 1 ? "memory is" : "memories are"} stored but not shown here; search memory for them.)`);
    return `${parts.join("\n\n")}\n`;
  };
  if (!entries.length) return "";
  let kept = [...entries];
  let text = render(kept, 0);
  const dropOrder = [...entries].sort((a, b) => a.priority - b.priority || a.order - b.order);
  while (text.length > maxChars && dropOrder.length) {
    const drop = dropOrder.shift()!;
    kept = kept.filter((entry) => entry !== drop);
    text = render(kept, entries.length - kept.length);
  }
  return text;
}

/** Renders the Brief from the archive and writes it for the system prompt. */
export function writeBrief(memoryDir: string, archive: MemoryArchive, now = Date.now()): string {
  const text = renderBrief({ current: archive.current(), ended: archive.endedSince(now - RECENT_DAYS * DAY_MS), now });
  if (readFile(briefPath(memoryDir)) !== text) writeFile(briefPath(memoryDir), text);
  return text;
}

/**
 * Keeps brief.md current: re-renders shortly after every memory change, and
 * hourly so dates ("was due", "recent") age correctly. Returns a stop function.
 */
export function keepBriefCurrent(memoryDir: string, archive: MemoryArchive, opts: { debounceMs?: number; hourlyMs?: number } = {}): () => void {
  let timer: NodeJS.Timeout | null = null;
  const refresh = () => {
    timer = null;
    try { writeBrief(memoryDir, archive); } catch { /* the previous Brief stays until the next change */ }
  };
  const unsubscribe = archive.subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(refresh, opts.debounceMs ?? 300);
  });
  const hourly = setInterval(refresh, opts.hourlyMs ?? 3_600_000);
  hourly.unref?.();
  refresh();
  return () => {
    unsubscribe();
    clearInterval(hourly);
    if (timer) clearTimeout(timer);
  };
}
