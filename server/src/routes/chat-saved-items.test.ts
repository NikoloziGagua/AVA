import express from "express";
import request from "supertest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { openDb } from "../state/db.js";
import { listMessages } from "../state/messages.js";
import { ActiveRuns } from "../orchestrator/active-runs.js";
import { MockLLMProvider } from "../orchestrator/llm/mock-provider.js";
import type { AgentEvent } from "../orchestrator/agent.js";
import { chatRoutes } from "./chat.js";

function setup(runAgentImpl: (opts: any) => Promise<void>) {
  const dataDir = mkdtempSync(join(tmpdir(), "ava-saved-items-"));
  const memoryDir = mkdtempSync(join(tmpdir(), "ava-saved-items-memory-"));
  const db = openDb(join(dataDir, "state.db"));
  db.prepare(
    "INSERT INTO device_tokens (id, token_hash, label, created_at) VALUES (?, ?, ?, ?)",
  ).run("saved-device", "saved-device-hash", "test", Date.now());
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.deviceId = "saved-device"; next(); });
  app.use("/api/chat", chatRoutes(
    db,
    new ActiveRuns(),
    (_req, _res, next) => next(),
    {
      pidfiles: { register: () => {}, unregister: () => {}, listForRun: () => [] } as never,
      fsRoots: [],
      memoryDir,
      dataDir,
      getChrome: async () => ({} as never),
      provider: new MockLLMProvider({ scripts: [] }),
      runAgentImpl: runAgentImpl as never,
    },
    { anthropic: null, openai: null },
  ));
  return { app, db };
}

const note = { kind: "note" as const, id: "note_groceries", title: "Groceries" };
const reminder = { kind: "reminder" as const, id: "w_clothes", title: "Hang the clothes" };

function savingRun(events: AgentEvent[]) {
  return vi.fn(async (opts: { emit: (event: AgentEvent) => void }) => {
    for (const event of events) opts.emit(event);
  });
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

describe("Saved items on the chat boundary", () => {
  it("stores what the turn saved on the assistant reply, once per item, in order", async () => {
    const { app, db } = setup(savingRun([
      { kind: "tool_call", payload: { tool: "notes_capture", args: {} } },
      { kind: "tool_result", payload: { tool: "notes_capture", ok: true, result: "Saved.", saved: note } },
      { kind: "tool_call", payload: { tool: "watch_create", args: {} } },
      { kind: "tool_result", payload: { tool: "watch_create", ok: true, result: "scheduled", saved: reminder } },
      // A repeat of the same item and a failed call add nothing.
      { kind: "tool_result", payload: { tool: "notes_capture", ok: true, result: "Saved.", saved: note } },
      { kind: "tool_result", payload: { tool: "notes_capture", ok: false, result: "no", saved: { kind: "note", id: "n_bad", title: "Bad" } } },
      { kind: "final", payload: { text: "Saved both, Sir." } },
      { kind: "done", payload: {} },
    ]));
    const started = await request(app).post("/api/chat").send({ text: "note groceries and remind me" }).expect(200);
    await settle();
    const assistant = listMessages(db, started.body.sessionId).find((message) => message.role === "assistant")!;
    expect(assistant.metadata?.savedItems).toEqual({ schemaVersion: 1, items: [note, reminder] });
  });

  it("does not add a Saved receipt when nothing was saved", async () => {
    const { app, db } = setup(savingRun([
      { kind: "final", payload: { text: "Hello, Sir." } },
      { kind: "done", payload: {} },
    ]));
    const started = await request(app).post("/api/chat").send({ text: "hello there friend" }).expect(200);
    await settle();
    const assistant = listMessages(db, started.body.sessionId).find((message) => message.role === "assistant")!;
    expect(assistant.metadata?.savedItems).toBeUndefined();
  });

  it("keeps what was saved even when the run then fails", async () => {
    const { app, db } = setup(savingRun([
      { kind: "tool_result", payload: { tool: "notes_capture", ok: true, result: "Saved.", saved: note } },
      { kind: "error", payload: { message: "model quota" } },
    ]));
    const started = await request(app).post("/api/chat").send({ text: "note groceries please" }).expect(200);
    await settle();
    const assistant = listMessages(db, started.body.sessionId).find((message) => message.role === "assistant")!;
    expect(assistant.content).toContain("model quota");
    expect(assistant.metadata?.savedItems?.items).toEqual([note]);
  });

  it("replays the Saved receipt to a stream that opens after a fast turn finished", async () => {
    const { app } = setup(savingRun([
      { kind: "tool_result", payload: { tool: "notes_capture", ok: true, result: "Saved.", saved: note } },
      { kind: "final", payload: { text: "Noted." } },
      { kind: "done", payload: {} },
    ]));
    const started = await request(app).post("/api/chat").send({ text: "note groceries now" }).expect(200);
    await settle();
    const stream = await request(app)
      .get(`/api/chat/${started.body.sessionId}/stream?taskId=${started.body.taskId}`)
      .buffer(true)
      .parse((res, done) => {
        let body = "";
        res.on("data", (chunk: Buffer) => { body += chunk.toString("utf8"); });
        res.on("end", () => done(null, body));
      });
    const text = stream.body as string;
    expect(text).toContain("event: saved_items");
    const savedIndex = text.indexOf("event: saved_items");
    expect(savedIndex).toBeLessThan(text.indexOf("event: done"));
    expect(text).toContain('"id":"note_groceries"');
  });
});
