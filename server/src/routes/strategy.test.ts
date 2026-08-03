import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { openInMemoryDb } from "../state/db.js";
import type { LLMProvider, StreamEvent, StreamInput } from "../orchestrator/llm/types.js";
import type { CodexConsultant } from "../strategy/codex-consultant.js";
import { StrategyRoomCoordinator } from "../strategy/coordinator.js";
import { StrategyRoomStore } from "../strategy/store.js";
import { strategyRoutes } from "./strategy.js";

function setup() {
  const db = openInMemoryDb();
  const provider: LLMProvider = {
    name: "openai",
    defaultOrchestratorModel: "test",
    defaultSideModel: "test",
    async *stream(_input: StreamInput): AsyncIterable<StreamEvent> {
      yield { kind: "delta", text: "# Objective\nTest the room\n# Recommended decision\nProceed carefully\nAwaiting Niko's approval — no implementation has started." };
      yield { kind: "done", stop_reason: "end_turn" };
    },
    complete: async () => "unused",
  };
  const codex: CodexConsultant = {
    probe: async () => ({ available: true, version: "codex 1", error: null }),
    consult: vi.fn(async (input) => ({
      ok: true as const,
      text: "Codex response",
      threadId: input.threadId ?? "thread-route",
      usage: null,
    })),
  };
  const coordinator = new StrategyRoomCoordinator({
    store: new StrategyRoomStore(db),
    provider,
    codex,
    repoRoot: "C:/repo",
  });
  const app = express();
  app.use(express.json());
  app.use("/api/strategy", strategyRoutes((_req, _res, next) => next(), coordinator));
  return { app, db, coordinator };
}

describe("Strategy Room API", () => {
  it("reports real participant boundaries", async () => {
    const { app, db } = setup();
    const response = await request(app).get("/api/strategy/meta").expect(200);
    expect(response.body).toMatchObject({
      authority: "ava",
      approvalEffect: "records_decision_only",
      codexBoundary: "dedicated_read_only_resumable_cli_thread",
      participants: {
        niko: { available: true },
        ava: { available: true },
        codex: { available: true, version: "codex 1" },
      },
    });
    db.close();
  });

  it("creates a room, accepts an interruption, and preserves attribution", async () => {
    const { app, db, coordinator } = setup();
    const created = await request(app)
      .post("/api/strategy/rooms")
      .send({ topic: "Improve AVA together" })
      .expect(202);
    const id = created.body.room.id as string;
    await vi.waitFor(() => expect(coordinator.deps.store.getRoom(id)?.status).toBe("awaiting_niko"));

    await request(app)
      .post(`/api/strategy/rooms/${id}/messages`)
      .send({ content: "I want the simplest version first." })
      .expect(202);
    await vi.waitFor(() => expect(coordinator.deps.store.getRoom(id)?.status).toBe("awaiting_niko"));
    const detail = await request(app).get(`/api/strategy/rooms/${id}`).expect(200);
    expect(detail.body.messages.some((message: { author: string; content: string }) =>
      message.author === "niko" && message.content.includes("simplest version"))).toBe(true);
    db.close();
  });

  it("rejects stale approval and records a decision without starting work", async () => {
    const { app, db, coordinator } = setup();
    const created = await request(app).post("/api/strategy/rooms").send({ topic: "Approve this" }).expect(202);
    const id = created.body.room.id as string;
    await vi.waitFor(() => expect(coordinator.deps.store.getRoom(id)?.status).toBe("awaiting_niko"));
    const current = coordinator.deps.store.getRoom(id)!;
    await request(app).post(`/api/strategy/rooms/${id}/approve`).send({ expectedVersion: current.version - 1 }).expect(409);
    const approved = await request(app).post(`/api/strategy/rooms/${id}/approve`).send({ expectedVersion: current.version }).expect(200);
    expect(approved.body.room.status).toBe("approved");
    expect(coordinator.deps.store.listMessages(id).at(-1)?.content).toContain("no implementation was started");
    db.close();
  });
});
