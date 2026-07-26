import express from "express";
import request from "supertest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ActiveRuns } from "../orchestrator/active-runs.js";
import { MockLLMProvider } from "../orchestrator/llm/mock-provider.js";
import { ObservabilityService } from "../observability/store.js";
import { openDb } from "../state/db.js";
import { chatRoutes } from "./chat.js";

describe("chat Mission Control instrumentation", () => {
  it("records one sanitized executor action beneath its voice causation context", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ava-mission-chat-"));
    const memoryDir = mkdtempSync(join(tmpdir(), "ava-mission-chat-memory-"));
    const db = openDb(join(dir, "state.db"));
    db.prepare(
      "INSERT INTO device_tokens (id, token_hash, label, created_at) VALUES (?, ?, ?, ?)",
    ).run("test-device", "test-hash", "test", Date.now());
    const observability = new ObservabilityService(db);
    const parent = observability.startRun({
      id: "voice-turn-parent",
      traceId: "trace-voice-complete",
      rootTaskId: "voice-root",
      runKind: "voice_turn",
      runtimeType: "ava",
      ownerType: "ava",
      title: "Voice request",
    });
    const runs = new ActiveRuns();
    const fake = vi.fn(async (options: { emit: (event: any) => void }) => {
      options.emit({
        kind: "tool_call",
        payload: { tool: "send_message", args: { password: "must-disappear", recipient: "Niko" } },
      });
      options.emit({
        kind: "tool_result",
        payload: { tool: "send_message", ok: true, result: "message visible" },
      });
      options.emit({ kind: "final", payload: { text: "Sent, but no independent delivery receipt was recorded." } });
      options.emit({ kind: "done", payload: {} });
    });
    const app = express();
    app.use(express.json());
    app.use((req: express.Request & { deviceId?: string }, _res, next) => {
      req.deviceId = "test-device";
      next();
    });
    app.use("/api/chat", chatRoutes(
      db,
      runs,
      (_req, _res, next) => next(),
      {
        pidfiles: { register: () => {}, unregister: () => {}, listForRun: () => [] } as any,
        fsRoots: [],
        memoryDir,
        dataDir: dir,
        getChrome: async () => ({} as any),
        provider: new MockLLMProvider({ scripts: [] }),
        runAgentImpl: fake as never,
        observability,
      },
      { anthropic: null, openai: null },
    ));

    const started = await request(app)
      .post("/api/chat")
      .send({
        text: "send the message",
        persist: false,
        observability: {
          traceId: parent.traceId,
          parentRunId: parent.id,
          parentSpanId: "span-delegation",
          causationEventId: "evt-delegation",
        },
      });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    for (let attempt = 0; attempt < 50 && runs.get(started.body.sessionId); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const run = observability.getRun(started.body.taskId)!;
    const events = observability.getEvents(started.body.taskId);
    expect(run).toMatchObject({
      traceId: parent.traceId,
      parentRunId: parent.id,
      rootTaskId: "voice-root",
      status: "completed",
      verificationStatus: "not_recorded",
    });
    expect(events.filter((event) => event.actionCounted)).toHaveLength(1);
    expect(events.find((event) => event.type === "tool.call.started")).toMatchObject({
      parentSpanId: "span-delegation",
      causationEventId: "evt-delegation",
      actionOwner: "executor",
    });
    expect(JSON.stringify(events)).not.toContain("must-disappear");
    expect(JSON.stringify(events)).toContain("***");
    db.close();
  });
});
