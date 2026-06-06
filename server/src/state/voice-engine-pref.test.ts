import { describe, it, expect } from "vitest";
import { openInMemoryDb } from "./db.js";
import { getVoiceEngine, setVoiceEngine } from "./voice-engine-pref.js";

describe("voice-engine-pref", () => {
  it("returns 'openai' as the default when unset", () => {
    const db = openInMemoryDb();
    expect(getVoiceEngine(db)).toBe("openai");
  });

  it("roundtrips a set value", () => {
    const db = openInMemoryDb();
    setVoiceEngine(db, "hume");
    expect(getVoiceEngine(db)).toBe("hume");
    setVoiceEngine(db, "openai");
    expect(getVoiceEngine(db)).toBe("openai");
  });

  it("upserts on a second set", () => {
    const db = openInMemoryDb();
    setVoiceEngine(db, "hume");
    setVoiceEngine(db, "openai");
    expect(getVoiceEngine(db)).toBe("openai");
  });

  it("falls back to 'openai' on a garbage or retired value", () => {
    const db = openInMemoryDb();
    // Write a bogus / retired value directly, bypassing the typed setter.
    for (const stale of ["nonsense", "chatterbox", "hybrid"]) {
      db.prepare(
        `INSERT INTO voice_engine_pref (scope_id, engine, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(scope_id) DO UPDATE SET engine = excluded.engine, updated_at = excluded.updated_at`,
      ).run("global", stale, Date.now());
      expect(getVoiceEngine(db)).toBe("openai");
    }
  });
});
