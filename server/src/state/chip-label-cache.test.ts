import { describe, it, expect } from "vitest";
import { openInMemoryDb } from "./db.js";
import { getCachedLabel, setCachedLabel, hashPrompt } from "./chip-label-cache.js";

describe("chip-label-cache", () => {
  it("hashes prompts deterministically", () => {
    expect(hashPrompt("hello")).toBe(hashPrompt("hello"));
    expect(hashPrompt("a")).not.toBe(hashPrompt("b"));
  });

  it("returns null on a miss", () => {
    const db = openInMemoryDb();
    expect(getCachedLabel(db, "dev1", hashPrompt("p"), 1000)).toBeNull();
  });

  it("returns a fresh hit", () => {
    const db = openInMemoryDb();
    const h = hashPrompt("p");
    setCachedLabel(db, "dev1", h, "List home folder", 1000 + 60_000);
    expect(getCachedLabel(db, "dev1", h, 1000)).toBe("List home folder");
  });

  it("returns null when the cached row is expired", () => {
    const db = openInMemoryDb();
    const h = hashPrompt("p");
    setCachedLabel(db, "dev1", h, "x", 500);
    expect(getCachedLabel(db, "dev1", h, 1000)).toBeNull();
  });

  it("upserts on a second write", () => {
    const db = openInMemoryDb();
    const h = hashPrompt("p");
    setCachedLabel(db, "dev1", h, "first", 5000);
    setCachedLabel(db, "dev1", h, "second", 5000);
    expect(getCachedLabel(db, "dev1", h, 1000)).toBe("second");
  });
});
