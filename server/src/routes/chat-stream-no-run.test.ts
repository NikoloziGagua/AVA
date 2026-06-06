import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../state/db.js";
import { createSession } from "../state/sessions.js";
import { appendMessage } from "../state/messages.js";
import { ActiveRuns } from "../orchestrator/active-runs.js";
import { chatRoutes } from "./chat.js";
import { MockLLMProvider } from "../orchestrator/llm/mock-provider.js";

// FIX 1: a fast turn can finish + unregister BEFORE the client opens the stream.
// The stream endpoint must then NOT 404 (which makes EventSource retry forever
// and never clears `busy`). Instead it replays the session's latest assistant
// reply as a `final` then `done`, so a late/fast connect terminates with the
// answer.
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "ava-streamnr-"));
  const memoryDir = mkdtempSync(join(tmpdir(), "ava-streamnr-mem-"));
  const db = openDb(join(dir, "x.db"));
  const runs = new ActiveRuns();
  const app = express();
  app.use(express.json());
  app.use((req: express.Request & { deviceId?: string }, _res, next) => { req.deviceId = "d"; next(); });
  app.use("/api/chat", chatRoutes(
    db, runs, (_q, _s, n) => n(),
    {
      pidfiles: { register: () => {}, unregister: () => {} } as never,
      fsRoots: [], memoryDir, dataDir: dir,
      getChrome: async () => ({} as never),
      provider: new MockLLMProvider({ scripts: [] }),
      runAgentImpl: (vi.fn() as never),
    },
    { anthropic: null, openai: null },
  ));
  return { app, db, runs };
}

/** Parse a raw SSE body into [{event, data}] pairs (ignores comment lines). */
function parseSse(body: string): Array<{ event: string; data: string }> {
  const out: Array<{ event: string; data: string }> = [];
  for (const block of body.split("\n\n")) {
    let event = "";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data = line.slice(5).trim();
    }
    if (event) out.push({ event, data });
  }
  return out;
}

describe("chat stream — no active run (fast-finish replay)", () => {
  it("replays the latest assistant reply as final + done (200, not 404)", async () => {
    const { app, db } = setup();
    const sid = createSession(db, { title: "t" }).id;
    appendMessage(db, { sessionId: sid, role: "user", content: "what's 2+2?" });
    appendMessage(db, { sessionId: sid, role: "assistant", content: "Four, Sir." });

    const res = await request(app).get(`/api/chat/${sid}/stream`).expect(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const events = parseSse(res.text);
    const fin = events.find((e) => e.event === "final");
    expect(fin).toBeTruthy();
    expect(JSON.parse(fin!.data)).toEqual({ text: "Four, Sir." });
    expect(events.at(-1)?.event).toBe("done");
  });

  it("emits done (no final) when there is no assistant message yet", async () => {
    const { app, db } = setup();
    const sid = createSession(db, { title: "t" }).id;
    appendMessage(db, { sessionId: sid, role: "user", content: "hi" });

    const res = await request(app).get(`/api/chat/${sid}/stream`).expect(200);
    const events = parseSse(res.text);
    expect(events.some((e) => e.event === "final")).toBe(false);
    expect(events.some((e) => e.event === "done")).toBe(true);
  });

  it("does NOT replay a stale assistant reply from a prior exchange", async () => {
    // Old completed exchange, then a fresh user turn with no reply yet. The
    // endpoint must not surface the old answer as this turn's result.
    const { app, db } = setup();
    const sid = createSession(db, { title: "t" }).id;
    appendMessage(db, { sessionId: sid, role: "user", content: "first?" });
    appendMessage(db, { sessionId: sid, role: "assistant", content: "old answer" });
    appendMessage(db, { sessionId: sid, role: "user", content: "second?" });

    const res = await request(app).get(`/api/chat/${sid}/stream`).expect(200);
    const events = parseSse(res.text);
    expect(events.some((e) => e.event === "final")).toBe(false);
    expect(events.some((e) => e.event === "done")).toBe(true);
  });

  it("emitted ids are greater than the client's lastEventId so they aren't deduped", async () => {
    const { app, db } = setup();
    const sid = createSession(db, { title: "t" }).id;
    appendMessage(db, { sessionId: sid, role: "user", content: "q" });
    appendMessage(db, { sessionId: sid, role: "assistant", content: "a" });

    const res = await request(app).get(`/api/chat/${sid}/stream?lastEventId=99`).expect(200);
    // Pull the `id:` lines straight from the raw body.
    const ids = res.text.split("\n").filter((l) => l.startsWith("id:")).map((l) => Number(l.slice(3).trim()));
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id).toBeGreaterThan(99);
  });
});
