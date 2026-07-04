import { nanoid } from "nanoid";
import { join } from "node:path";
import { readFile, writeFile } from "../memory/store.js";

// The people map — Ava's identity-resolution layer. Sir says "text Lasha";
// Lasha's Instagram username is weird_username_123; this file knows that, plus
// the DM thread id learned from the first successful message (the fast path:
// one navigation, zero searching). Stored under memoryDir (secret-scrubbed
// writes), one JSON file — tens of people, not thousands.

export type PersonApp = {
  username?: string;      // instagram handle / whatsapp display name
  phone?: string;         // whatsapp
  threadId?: string;      // learned DM thread — the speed unlock
};

export type Person = {
  id: string;
  name: string;
  aliases: string[];
  instagram?: PersonApp;
  whatsapp?: PersonApp;
  notes?: string;
  updated: string;        // yyyy-mm-dd
};

const file = (memoryDir: string) => join(memoryDir, "people.json");

export function listPeople(memoryDir: string): Person[] {
  const c = readFile(file(memoryDir));
  if (!c) return [];
  try {
    const j = JSON.parse(c);
    return Array.isArray(j) ? (j as Person[]) : [];
  } catch { return []; }
}

function save(memoryDir: string, people: Person[]): void {
  writeFile(file(memoryDir), JSON.stringify(people, null, 2));
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Resolve "who is X". Exact name/alias match wins; then username/phone match;
 * then substring. Ambiguity returns candidates so Ava can ask Sir instead of
 * messaging the wrong human — the one unforgivable failure for a messenger.
 */
export function resolvePerson(memoryDir: string, query: string): { person: Person | null; candidates: Person[] } {
  const q = norm(query);
  if (!q) return { person: null, candidates: [] };
  const people = listPeople(memoryDir);

  const exact = people.filter((p) =>
    norm(p.name) === q || p.aliases.some((a) => norm(a) === q));
  if (exact.length === 1) return { person: exact[0]!, candidates: exact };
  if (exact.length > 1) return { person: null, candidates: exact };

  const byHandle = people.filter((p) =>
    norm(p.instagram?.username ?? "") === q ||
    (p.whatsapp?.phone ?? "").replace(/\D/g, "") === query.replace(/\D/g, "") && query.replace(/\D/g, "").length >= 7);
  if (byHandle.length === 1) return { person: byHandle[0]!, candidates: byHandle };

  const partial = people.filter((p) =>
    norm(p.name).includes(q) || p.aliases.some((a) => norm(a).includes(q)));
  if (partial.length === 1) return { person: partial[0]!, candidates: partial };
  return { person: null, candidates: partial.length ? partial : byHandle };
}

/** Create or merge a person. Matching by name/alias (case-insensitive). */
export function upsertPerson(memoryDir: string, patch: {
  name: string; aliases?: string[];
  instagram?: PersonApp; whatsapp?: PersonApp; notes?: string;
}): Person {
  const people = listPeople(memoryDir);
  const today = new Date().toISOString().slice(0, 10);
  const q = norm(patch.name);
  let p = people.find((x) => norm(x.name) === q || x.aliases.some((a) => norm(a) === q));
  if (!p) {
    p = { id: nanoid(10), name: patch.name, aliases: [], updated: today };
    people.push(p);
  }
  if (patch.aliases?.length) {
    p.aliases = [...new Set([...p.aliases, ...patch.aliases.filter((a) => norm(a) !== norm(p!.name))])];
  }
  // A changed identity invalidates the thread learned under the OLD identity —
  // keeping it would fast-path Sir's messages to the wrong person's chat.
  if (patch.instagram) {
    const usernameChanged = patch.instagram.username && p.instagram?.username
      && patch.instagram.username !== p.instagram.username;
    p.instagram = { ...p.instagram, ...patch.instagram };
    if (usernameChanged && !patch.instagram.threadId) delete p.instagram.threadId;
  }
  if (patch.whatsapp) {
    const identityChanged = (patch.whatsapp.username && p.whatsapp?.username && patch.whatsapp.username !== p.whatsapp.username)
      || (patch.whatsapp.phone && p.whatsapp?.phone && patch.whatsapp.phone !== p.whatsapp.phone);
    p.whatsapp = { ...p.whatsapp, ...patch.whatsapp };
    if (identityChanged && !patch.whatsapp.threadId) delete p.whatsapp.threadId;
  }
  if (patch.notes) p.notes = patch.notes;
  p.updated = today;
  save(memoryDir, people);
  return p;
}

/** Persist a learned per-app field (e.g. the Instagram thread id) by person id. */
export function setAppField(
  memoryDir: string, personId: string,
  app: "instagram" | "whatsapp", field: keyof PersonApp, value: string,
): void {
  const people = listPeople(memoryDir);
  const p = people.find((x) => x.id === personId);
  if (!p) return;
  p[app] = { ...p[app], [field]: value };
  p.updated = new Date().toISOString().slice(0, 10);
  save(memoryDir, people);
}
