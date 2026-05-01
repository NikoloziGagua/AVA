import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../state/db.js";
import { appendMessage, type Role } from "../state/messages.js";
import { createSession } from "../state/sessions.js";
import { ActiveRuns } from "../orchestrator/active-runs.js";
import { chatRoutes } from "./chat.js";
import { MockLLMProvider } from "../orchestrator/llm/mock-provider.js";
import { memoryPaths } from "../memory/paths.js";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "ava-autolearn-"));
  const memoryDir = mkdtempSync(join(tmpdir(), "ava-autolearn-mem-"));
  const db = openDb(join(dir, "x.db"));
  // Seed a device token so markGreetingSent (device_state FK) doesn't fail.
  db.prepare(
    "INSERT INTO device_tokens (id, token_hash, label, created_at) VALUES (?, ?, ?, ?)",
  ).run("device-test", "hash-device-test", "test", Date.now());
  const runs = new ActiveRuns();
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => { req.deviceId = "device-test"; next(); });
  const auth = (_req: any, _res: any, next: any) => next();
  const provider = new MockLLMProvider({
    scripts: [[{ kind: "delta", text: "ok" }, { kind: "done", stop_reason: "end_turn" }]],
  });
  const runAgentImpl = vi.fn(async () => {});
  app.use("/api/chat", chatRoutes(
    db, runs, auth,
    {
      pidfiles: { register: () => {}, unregister: () => {} } as any,
      fsRoots: [], memoryDir,
      getChrome: async () => ({} as any),
      provider, runAgentImpl,
    },
    { anthropic: null, openai: null },
  ));
  return { app, db, memoryDir };
}

describe("chat auto-learn", () => {
  it("appends a (corrected) observation when user replies 'no, don't ...' to a recent assistant turn", async () => {
    const { app, db, memoryDir } = setup();
    const s = createSession(db, { title: "t" });
    appendMessage(db, { sessionId: s.id, role: "assistant" as Role,
      content: "running ls now Sir" });
    await request(app).post("/api/chat").send({
      sessionId: s.id, text: "no, don't auto-run things",
    }).expect(200);
    await new Promise((r) => setTimeout(r, 20));
    const obs = readFileSync(memoryPaths(memoryDir).observations, "utf8");
    expect(obs).toMatch(/\[\d{4}-\d{2}-\d{2} \/ low \/ preferences\] \(corrected\) no, don't/);
  });

  it("does not fire when the prior turn is the user", async () => {
    const { app, db, memoryDir } = setup();
    const s = createSession(db, { title: "t" });
    appendMessage(db, { sessionId: s.id, role: "user" as Role,
      content: "first message" });
    await request(app).post("/api/chat").send({
      sessionId: s.id, text: "no, that's not right",
    }).expect(200);
    await new Promise((r) => setTimeout(r, 20));
    const path = memoryPaths(memoryDir).observations;
    if (existsSync(path)) {
      expect(readFileSync(path, "utf8")).not.toContain("(corrected)");
    }
  });
});
