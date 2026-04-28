import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "../state/db.js";
import { createSession, getSessionFull } from "../state/sessions.js";
import { appendMessage } from "../state/messages.js";
import { maybeSummarize } from "./auto-summary.js";
import { MockLLMProvider } from "./llm/mock-provider.js";

let db: Db;
beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "ava-summ-"));
  db = openDb(join(dir, "x.db"));
});

describe("maybeSummarize", () => {
  it("does nothing when message count <= threshold", async () => {
    const s = createSession(db, { title: "t" });
    for (let i = 0; i < 10; i++) appendMessage(db, { sessionId: s.id, role: "user", content: `m${i}` });
    const provider = new MockLLMProvider({ completions: [] });
    const spy = vi.spyOn(provider, "complete");
    await maybeSummarize({ db, sessionId: s.id, provider, threshold: 50, keepRecent: 20 });
    expect(spy).not.toHaveBeenCalled();
  });

  it("summarizes the oldest messages and stores summary + through_id when count > threshold", async () => {
    const s = createSession(db, { title: "t" });
    for (let i = 0; i < 60; i++) appendMessage(db, { sessionId: s.id, role: "user", content: `m${i}` });
    const provider = new MockLLMProvider({ completions: ["earlier discussion of m0..m39"] });
    await maybeSummarize({ db, sessionId: s.id, provider, threshold: 50, keepRecent: 20 });
    const full = getSessionFull(db, s.id)!;
    expect(full.summary).toBe("earlier discussion of m0..m39");
    // 60 - 20 = 40 collapsed; throughId is the id of the 40th message (1-indexed → message #40)
    expect(typeof full.summary_through_message_id).toBe("number");
    expect(full.summary_through_message_id).toBeGreaterThan(0);
  });

  it("on API failure, leaves summary unset (skip-on-failure)", async () => {
    const s = createSession(db, { title: "t" });
    for (let i = 0; i < 60; i++) appendMessage(db, { sessionId: s.id, role: "user", content: `m${i}` });
    // Empty completions list causes complete() to throw.
    const provider = new MockLLMProvider({ completions: [] });
    await maybeSummarize({ db, sessionId: s.id, provider, threshold: 50, keepRecent: 20 });
    const full = getSessionFull(db, s.id)!;
    expect(full.summary).toBeNull();
  });

  it("re-running on the same session re-summarizes only the new tail", async () => {
    const s = createSession(db, { title: "t" });
    for (let i = 0; i < 60; i++) appendMessage(db, { sessionId: s.id, role: "user", content: `m${i}` });
    const provider = new MockLLMProvider({ completions: ["first summary", "second summary"] });
    await maybeSummarize({ db, sessionId: s.id, provider, threshold: 50, keepRecent: 20 });
    const after1 = getSessionFull(db, s.id)!.summary_through_message_id;
    for (let i = 60; i < 90; i++) appendMessage(db, { sessionId: s.id, role: "user", content: `m${i}` });
    await maybeSummarize({ db, sessionId: s.id, provider, threshold: 50, keepRecent: 20 });
    const full = getSessionFull(db, s.id)!;
    expect(full.summary).toBe("second summary");
    expect(full.summary_through_message_id).toBeGreaterThan(after1!);
  });
});
