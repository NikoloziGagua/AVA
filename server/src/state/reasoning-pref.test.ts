import { describe, it, expect } from "vitest";
import { openInMemoryDb } from "./db.js";
import { getReasoningLevel, setReasoningLevel } from "./reasoning-pref.js";

describe("reasoning-pref", () => {
  it("returns 'fast' as the default when unset", () => {
    const db = openInMemoryDb();
    expect(getReasoningLevel(db)).toBe("fast");
  });

  it("roundtrips a set value", () => {
    const db = openInMemoryDb();
    setReasoningLevel(db, "thorough");
    expect(getReasoningLevel(db)).toBe("thorough");
  });

  it("upserts on a second set", () => {
    const db = openInMemoryDb();
    setReasoningLevel(db, "thorough");
    setReasoningLevel(db, "fast");
    expect(getReasoningLevel(db)).toBe("fast");
  });
});
