import { describe, expect, it } from "vitest";
import { openInMemoryDb } from "../state/db.js";
import { AgentObservabilityRecorder } from "./agent-adapter.js";
import { ObservabilityService } from "./store.js";

function setup() {
  const db = openInMemoryDb();
  const observability = new ObservabilityService(db);
  const run = observability.startRun({
    id: "chat-run",
    runKind: "chat_turn",
    runtimeType: "ava",
    ownerType: "ava",
    title: "Chat turn",
  });
  return { db, observability, run, recorder: new AgentObservabilityRecorder(observability, run.id) };
}

describe("AgentObservabilityRecorder", () => {
  it("keeps the response nonterminal and completes only when the runtime finishes", () => {
    const { db, observability, run, recorder } = setup();
    recorder.record({ kind: "final", payload: { text: "Done." } }, { at: 1_100 });
    expect(observability.getRun(run.id)?.status).toBe("running");

    recorder.record({ kind: "done", payload: {} }, { at: 1_200 });
    const events = observability.getEvents(run.id);
    expect(observability.getRun(run.id)).toMatchObject({
      status: "completed",
      outcome: "result_returned_unverified",
    });
    expect(events.find((event) => event.type === "agent.response.completed")).toMatchObject({
      terminal: false,
      late: false,
    });
    expect(events.find((event) => event.type === "agent.runtime.finished")).toMatchObject({
      terminal: true,
      late: false,
    });
    db.close();
  });

  it("does not append a late successful finish after cancellation", () => {
    const { db, observability, run, recorder } = setup();
    recorder.record({ kind: "killed", payload: { reason: "manual" } });
    recorder.record({ kind: "done", payload: {} });
    expect(observability.getRun(run.id)?.status).toBe("cancelled");
    expect(observability.getEvents(run.id).filter((event) => event.terminal)).toHaveLength(1);
    expect(observability.getEvents(run.id).some((event) => event.late)).toBe(false);
    db.close();
  });

  it("records provider usage once without inventing a monetary cost", () => {
    const { db, observability, run, recorder } = setup();
    const usage = {
      providerRequestId: "resp_123",
      model: "gpt-5.6",
      inputTokens: 120,
      outputTokens: 30,
      cachedTokens: 20,
    };
    recorder.recordUsage(usage);
    recorder.recordUsage(usage);
    expect(observability.getRun(run.id)).toMatchObject({
      inputTokens: 120,
      outputTokens: 30,
      cachedTokens: 20,
      directCostMicrousd: 0,
    });
    expect(observability.getEvents(run.id).filter((event) => event.type === "provider.usage.recorded")).toHaveLength(1);
    db.close();
  });
});
