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

  it("projects explicit verification evidence without counting executor ok as proof", () => {
    const { db, observability, run, recorder } = setup();
    recorder.record({ kind: "tool_call", payload: { tool: "fs_write", args: {} } }, { at: 1_050 });
    recorder.record({ kind: "tool_result", payload: {
      tool: "fs_write", ok: true, result: "written",
      verification: {
        state: "verified", scope: "task_outcome", method: "fs_readback",
        summary: "The file content matched exactly.",
      },
    } }, { at: 1_100 });
    recorder.record({ kind: "final", payload: { text: "Done." } }, { at: 1_150 });
    recorder.record({ kind: "done", payload: {} }, { at: 1_200 });

    expect(observability.getRun(run.id)).toMatchObject({
      status: "completed",
      verificationStatus: "verified",
      outcome: "verified_by_tool_evidence",
    });
    expect(observability.getEvents(run.id).filter((event) =>
      event.type === "verification.evidence.recorded")).toHaveLength(1);
    db.close();
  });

  it("keeps contradicted evidence distinct from an executor report", () => {
    const { db, observability, run, recorder } = setup();
    recorder.record({ kind: "tool_result", payload: {
      tool: "fs_write", ok: false, result: "mismatch",
      verification: {
        state: "contradicted", scope: "task_outcome", method: "fs_readback",
        summary: "The readback differed.",
      },
    } });
    recorder.record({ kind: "final", payload: { text: "The check failed." } });
    recorder.record({ kind: "done", payload: {} });
    expect(observability.getRun(run.id)).toMatchObject({
      verificationStatus: "not_verified",
      outcome: "executor_result_contradicted",
    });
    db.close();
  });

  it("does not promote a mixed verified and failed tool run to verified", () => {
    const { db, observability, run, recorder } = setup();
    recorder.record({ kind: "tool_result", payload: {
      tool: "fs_write", ok: true, result: "written",
      verification: {
        state: "verified", scope: "task_outcome", method: "fs_readback",
        summary: "The file content matched exactly.",
      },
    } });
    recorder.record({ kind: "tool_result", payload: {
      tool: "follow_up", ok: false, result: "The follow-up step failed.",
    } });
    recorder.record({ kind: "final", payload: { text: "Only part of the task completed." } });
    recorder.record({ kind: "done", payload: {} });

    expect(observability.getRun(run.id)).toMatchObject({
      verificationStatus: "partially_verified",
      outcome: "partial_with_tool_failure",
    });
    db.close();
  });
});
