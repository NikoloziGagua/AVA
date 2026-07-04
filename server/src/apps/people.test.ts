import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listPeople, resolvePerson, setAppField, upsertPerson } from "./people.js";

// Unit tests for the people map — Ava's identity-resolution layer. Everything
// runs against a throwaway memoryDir so the real people.json is never touched.

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ava-people-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("upsertPerson", () => {
  it("creates a new person with an id and today's updated stamp", () => {
    const p = upsertPerson(dir, { name: "Lasha", instagram: { username: "lasha_b" } });
    expect(p.id).toBeTruthy();
    expect(p.name).toBe("Lasha");
    expect(p.aliases).toEqual([]);
    expect(p.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const all = listPeople(dir);
    expect(all).toHaveLength(1);
    expect(all[0]!.instagram?.username).toBe("lasha_b");
  });

  it("merges by name, case- and punctuation-insensitively, keeping the original name", () => {
    const created = upsertPerson(dir, { name: "Gio", notes: "old friend" });
    const merged = upsertPerson(dir, { name: "GIO!", instagram: { username: "gio.ge" } });
    expect(merged.id).toBe(created.id);
    const all = listPeople(dir);
    expect(all).toHaveLength(1);
    expect(all[0]!.name).toBe("Gio");
    expect(all[0]!.notes).toBe("old friend");
    expect(all[0]!.instagram?.username).toBe("gio.ge");
  });

  it("merges by alias: upserting under an alias updates the existing person", () => {
    const created = upsertPerson(dir, { name: "Aleksandre", aliases: ["Sandro"] });
    const merged = upsertPerson(dir, { name: "sandro", notes: "gym buddy" });
    expect(merged.id).toBe(created.id);
    const all = listPeople(dir);
    expect(all).toHaveLength(1);
    expect(all[0]!.name).toBe("Aleksandre");
    expect(all[0]!.notes).toBe("gym buddy");
  });

  it("dedupes aliases and drops aliases that are just the person's own name", () => {
    upsertPerson(dir, { name: "Nika", aliases: ["Nik", "Nik"] });
    upsertPerson(dir, { name: "Nika", aliases: ["Nik", "Bro", "nika"] });
    const p = listPeople(dir)[0]!;
    expect(p.aliases).toEqual(["Nik", "Bro"]);
  });

  it("merges per-app fields instead of overwriting the whole app object", () => {
    upsertPerson(dir, { name: "Lasha", instagram: { username: "lasha_b" } });
    upsertPerson(dir, { name: "Lasha", instagram: { threadId: "123" } });
    const p = listPeople(dir)[0]!;
    expect(p.instagram).toEqual({ username: "lasha_b", threadId: "123" });
  });

  it("recovers from a corrupt store by starting a fresh list", () => {
    writeFileSync(join(dir, "people.json"), "{{{ not json", "utf8");
    upsertPerson(dir, { name: "Phoenix" });
    const all = listPeople(dir);
    expect(all).toHaveLength(1);
    expect(all[0]!.name).toBe("Phoenix");
  });
});

describe("resolvePerson", () => {
  it("resolves an exact name match", () => {
    upsertPerson(dir, { name: "Lasha Beridze" });
    const { person, candidates } = resolvePerson(dir, "lasha beridze");
    expect(person?.name).toBe("Lasha Beridze");
    expect(candidates).toHaveLength(1);
  });

  it("prefers an exact match over partial matches", () => {
    upsertPerson(dir, { name: "Nika" });
    upsertPerson(dir, { name: "Nika Gagua" });
    const { person } = resolvePerson(dir, "Nika");
    expect(person?.name).toBe("Nika");
  });

  it("resolves by alias", () => {
    upsertPerson(dir, { name: "Aleksandre", aliases: ["Sandro"] });
    const { person } = resolvePerson(dir, "SANDRO");
    expect(person?.name).toBe("Aleksandre");
  });

  it("resolves by Instagram username, case-insensitively", () => {
    upsertPerson(dir, { name: "Weird Guy", instagram: { username: "weird_username_123" } });
    expect(resolvePerson(dir, "weird_username_123").person?.name).toBe("Weird Guy");
    expect(resolvePerson(dir, "WEIRD_USERNAME_123").person?.name).toBe("Weird Guy");
  });

  it("resolves by phone digits regardless of formatting", () => {
    upsertPerson(dir, { name: "Mariam", whatsapp: { phone: "+995 555 123 456" } });
    const { person } = resolvePerson(dir, "995-555-123-456");
    expect(person?.name).toBe("Mariam");
  });

  it("does not match on a partial phone number", () => {
    upsertPerson(dir, { name: "Mariam", whatsapp: { phone: "+995 555 123 456" } });
    const { person, candidates } = resolvePerson(dir, "555123456");
    expect(person).toBeNull();
    expect(candidates).toEqual([]);
  });

  it("returns candidates with person null when an exact alias is ambiguous", () => {
    upsertPerson(dir, { name: "Giorgi Beruashvili", aliases: ["Gio"] });
    upsertPerson(dir, { name: "Giorgi Machavariani", aliases: ["Gio"] });
    const { person, candidates } = resolvePerson(dir, "gio");
    expect(person).toBeNull();
    expect(candidates.map((c) => c.name).sort()).toEqual([
      "Giorgi Beruashvili",
      "Giorgi Machavariani",
    ]);
  });

  it("returns candidates with person null when a partial query is ambiguous", () => {
    upsertPerson(dir, { name: "Lasha Beridze" });
    upsertPerson(dir, { name: "Lasha Kapanadze" });
    const { person, candidates } = resolvePerson(dir, "Lasha");
    expect(person).toBeNull();
    expect(candidates).toHaveLength(2);
  });

  it("resolves a partial query with a single match", () => {
    upsertPerson(dir, { name: "Lasha Beridze" });
    upsertPerson(dir, { name: "Lasha Kapanadze" });
    const { person } = resolvePerson(dir, "kapan");
    expect(person?.name).toBe("Lasha Kapanadze");
  });

  it("returns empty for an empty or punctuation-only query", () => {
    upsertPerson(dir, { name: "Lasha" });
    expect(resolvePerson(dir, "")).toEqual({ person: null, candidates: [] });
    expect(resolvePerson(dir, "!!!")).toEqual({ person: null, candidates: [] });
  });

  it("returns nothing against a corrupt store instead of throwing", () => {
    writeFileSync(join(dir, "people.json"), "{{{ not json", "utf8");
    expect(resolvePerson(dir, "anyone")).toEqual({ person: null, candidates: [] });
  });
});

describe("setAppField", () => {
  it("persists a learned threadId without clobbering other app fields", () => {
    const p = upsertPerson(dir, { name: "Lasha", instagram: { username: "lasha_b" } });
    setAppField(dir, p.id, "instagram", "threadId", "31337");
    const got = listPeople(dir)[0]!;
    expect(got.instagram).toEqual({ username: "lasha_b", threadId: "31337" });
    expect(got.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("creates the app object when the person had none", () => {
    const p = upsertPerson(dir, { name: "Guram" });
    setAppField(dir, p.id, "whatsapp", "phone", "+995555000111");
    expect(listPeople(dir)[0]!.whatsapp).toEqual({ phone: "+995555000111" });
  });

  it("is a no-op for an unknown person id", () => {
    const p = upsertPerson(dir, { name: "Lasha", instagram: { threadId: "1" } });
    setAppField(dir, "no-such-id", "instagram", "threadId", "999");
    const all = listPeople(dir);
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe(p.id);
    expect(all[0]!.instagram?.threadId).toBe("1");
  });
});

describe("listPeople", () => {
  it("returns [] when the file does not exist", () => {
    expect(listPeople(dir)).toEqual([]);
  });

  it("returns [] when people.json is corrupt", () => {
    writeFileSync(join(dir, "people.json"), "{{{ definitely not json", "utf8");
    expect(listPeople(dir)).toEqual([]);
  });

  it("returns [] when people.json holds valid JSON that is not an array", () => {
    writeFileSync(join(dir, "people.json"), '{"not":"an array"}', "utf8");
    expect(listPeople(dir)).toEqual([]);
  });
});
