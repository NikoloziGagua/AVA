import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../state/db.js";
import { appendMessage, listMessages } from "../state/messages.js";
import { createSession } from "../state/sessions.js";
import { ActiveRuns } from "../orchestrator/active-runs.js";
import { chatRoutes } from "./chat.js";
import { MockLLMProvider } from "../orchestrator/llm/mock-provider.js";

// The `persist` flag exists so the HYBRID voice proxy can run the real /api/chat
// agent (full tools) for a do_on_computer task WITHOUT the route storing any
// messages — the realtime proxy is the single source of truth for spoken turns,
// so a persisting /api/chat run would double-store the voice conversation.
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "ava-persist-"));
  const memoryDir = mkdtempSync(join(tmpdir(), "ava-persist-mem-"));
  const db = openDb(join(dir, "x.db"));
  db.prepare(
    "INSERT INTO device_tokens (id, token_hash, label, created_at) VALUES (?, ?, ?, ?)",
  ).run("device-test", "hash-device-test", "test", Date.now());
  const runs = new ActiveRuns();
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.deviceId = "device-test"; next(); });
  const auth = (_req: any, _res: any, next: any) => next();
  const provider = new MockLLMProvider({ scripts: [] });
  // Fake agent loop that emits a single `final` turn, so we can prove the
  // assistant message store is gated by `persist` too (not just the user turn).
  const runAgentImpl = vi.fn(async (opts: { emit: (e: unknown) => void }) => {
    opts.emit({ kind: "final", payload: { text: "all done, Sir" } });
  });
  app.use("/api/chat", chatRoutes(
    db, runs, auth,
    {
      pidfiles: { register: () => {}, unregister: () => {} } as any,
      fsRoots: [], memoryDir, dataDir: dir,
      getChrome: async () => ({} as any),
      provider, runAgentImpl: runAgentImpl as never,
    },
    { anthropic: null, openai: null },
  ));
  return { app, db, runAgentImpl };
}

describe("chat persist flag", () => {
  it("persist:false runs the agent but stores NO user or assistant message", async () => {
    const { app, db } = setup();
    const started = await request(app)
      .post("/api/chat")
      .send({ text: "open my downloads", persist: false })
      .expect(200);
    const sessionId = started.body.sessionId as string;
    // Let the fire-and-forget run emit its `final` event.
    await new Promise((r) => setTimeout(r, 30));
    expect(listMessages(db, sessionId)).toEqual([]);
  });

  it("persist:false executes the transient task in a resumed session and retains prior history", async () => {
    const { app, db, runAgentImpl } = setup();
    const session = createSession(db, { title: "Codex voice session" });
    appendMessage(db, {
      sessionId: session.id,
      role: "user",
      content: "Open Codex in my AVA project.",
    });
    appendMessage(db, {
      sessionId: session.id,
      role: "assistant",
      content: "Codex is open.",
    });
    // This is the incomplete spoken transcript that caused the realtime model to
    // generate the more precise transient action below.
    appendMessage(db, {
      sessionId: session.id,
      role: "user",
      content: "You are",
    });
    const transientTask =
      "Find and focus the existing Codex terminal, send /resume, and report its output.";

    await request(app)
      .post("/api/chat")
      .send({ sessionId: session.id, text: transientTask, persist: false })
      .expect(200);
    await new Promise((r) => setTimeout(r, 30));

    expect(runAgentImpl).toHaveBeenCalledTimes(1);
    const opts = runAgentImpl.mock.calls[0]?.[0] as unknown as {
      prompt: string;
      priorMessages: Array<{ role: string; content: string }>;
    };
    expect(opts.prompt).toContain(transientTask);
    expect(opts.prompt).not.toContain("You are");
    expect(opts.priorMessages).toEqual([
      { role: "user", content: "Open Codex in my AVA project." },
      { role: "assistant", content: "Codex is open." },
    ]);
    expect(listMessages(db, session.id).map((m) => [m.role, m.content])).toEqual([
      ["user", "Open Codex in my AVA project."],
      ["assistant", "Codex is open."],
      ["user", "You are"],
    ]);
  });

  it("by default (persist omitted) the user turn AND the assistant final are stored", async () => {
    const { app, db } = setup();
    const started = await request(app)
      .post("/api/chat")
      .send({ text: "open my downloads" })
      .expect(200);
    const sessionId = started.body.sessionId as string;
    await new Promise((r) => setTimeout(r, 30));
    const msgs = listMessages(db, sessionId);
    expect(msgs.map((m) => [m.role, m.content])).toEqual([
      ["user", "open my downloads"],
      ["assistant", "all done, Sir"],
    ]);
  });

  it("persist:true behaves like the default (messages are stored)", async () => {
    const { app, db } = setup();
    const started = await request(app)
      .post("/api/chat")
      .send({ text: "open my downloads", persist: true })
      .expect(200);
    const sessionId = started.body.sessionId as string;
    await new Promise((r) => setTimeout(r, 30));
    expect(listMessages(db, sessionId).map((m) => m.role)).toEqual(["user", "assistant"]);
  });
});
