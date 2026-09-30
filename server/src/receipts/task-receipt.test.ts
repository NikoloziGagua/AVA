import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../orchestrator/agent.js";
import { TaskReceiptBuilder } from "./task-receipt.js";

function build(mode: "conversation" | "action" = "action") {
  return new TaskReceiptBuilder({
    taskId: "task-visibility-1",
    objective: "Complete the requested task",
    mode,
    startedAt: 1_000,
  });
}

function observe(builder: TaskReceiptBuilder, ...events: AgentEvent[]) {
  for (const event of events) builder.observe(event);
  return builder.snapshot(2_000);
}

describe("TaskReceiptBuilder", () => {
  it("verifies only conversation response delivery, without claiming an external outcome", () => {
    const receipt = observe(
      build("conversation"),
      { kind: "final", payload: { text: "Hello, Sir." } },
      { kind: "done", payload: {} },
    );

    expect(receipt).toMatchObject({
      lifecycle: "finished",
      outcome: "verified",
      verificationScope: "response_delivery",
      lastVerifiedStage: "The final response reached this conversation.",
      observationPoint: null,
      rootCause: "not_applicable",
    });
    expect(receipt.actual).toContain("no external action was claimed");
  });

  it("keeps successful action tools unverified when no independent outcome verifier ran", () => {
    const receipt = observe(
      build(),
      { kind: "tool_call", payload: { tool: "shell", args: { command: "Get-Date" } } },
      { kind: "tool_result", payload: { tool: "shell", ok: true, result: "EXIT 0" } },
      { kind: "final", payload: { text: "Done." } },
      { kind: "done", payload: {} },
    );

    expect(receipt).toMatchObject({
      lifecycle: "finished",
      outcome: "unverified",
      verificationScope: "operational_steps",
      successfulToolResults: 1,
      failedToolResults: 0,
      rootCause: "unknown",
    });
    expect(receipt.observationPoint).toContain("no independent outcome verifier");
  });

  it("marks an action verified only when task-outcome evidence is recorded", () => {
    const receipt = observe(
      build(),
      { kind: "tool_call", payload: { tool: "fs_write", args: {} } },
      { kind: "tool_result", payload: {
        tool: "fs_write", ok: true, result: "written",
        verification: {
          state: "verified", scope: "task_outcome", method: "fs_readback",
          summary: "The file content matched exactly.", observedAt: 1_500,
        },
      } },
      { kind: "final", payload: { text: "Done." } },
      { kind: "done", payload: {} },
    );
    expect(receipt).toMatchObject({
      outcome: "verified",
      verificationScope: "task_outcome",
      verificationMethod: "fs_readback",
      verificationObservedAt: 1_500,
    });
    expect(receipt.evidence.some((item) => item.kind === "verification")).toBe(true);
  });

  it("lets contradiction override executor-reported success", () => {
    const receipt = observe(
      build(),
      { kind: "tool_result", payload: {
        tool: "fs_write", ok: false, result: "readback mismatch",
        verification: {
          state: "contradicted", scope: "task_outcome", method: "fs_readback",
          summary: "The bytes read back did not match.",
        },
      } },
      { kind: "final", payload: { text: "The check failed." } },
      { kind: "done", payload: {} },
    );
    expect(receipt).toMatchObject({ outcome: "contradicted", rootCause: "known" });
    expect(receipt.actual).toContain("contradicted");
  });

  it("keeps mixed verified and failed operations partial", () => {
    const receipt = observe(
      build(),
      { kind: "tool_result", payload: {
        tool: "fs_write", ok: true, result: "written",
        verification: {
          state: "verified", scope: "task_outcome", method: "fs_readback",
          summary: "The file matched.",
        },
      } },
      { kind: "tool_result", payload: { tool: "notify", ok: false, result: "timeout" } },
      { kind: "final", payload: { text: "Only part completed." } },
      { kind: "done", payload: {} },
    );
    expect(receipt.outcome).toBe("partial");
  });

  it("reports a partial outcome when some operational work succeeded before a tool failure", () => {
    const receipt = observe(
      build(),
      { kind: "tool_call", payload: { tool: "fs_read", args: {} } },
      { kind: "tool_result", payload: { tool: "fs_read", ok: true, result: "read" } },
      { kind: "tool_call", payload: { tool: "shell", args: {} } },
      { kind: "tool_result", payload: { tool: "shell", ok: false, result: "timeout exceeded" } },
      { kind: "final", payload: { text: "I only completed the first part." } },
      { kind: "done", payload: {} },
    );

    expect(receipt).toMatchObject({
      lifecycle: "finished",
      outcome: "partial",
      successfulToolResults: 1,
      failedToolResults: 1,
      rootCause: "likely",
    });
    expect(receipt.lastVerifiedStage).toContain("fs read");
    expect(receipt.observationPoint).toContain("shell returned an error");
    expect(receipt.recoveryAction).toContain("Retry");
  });

  it("separates an approval block from outcome verification", () => {
    const builder = build();
    builder.observe({
      kind: "approval_required",
      payload: { id: "approval-1", tool: "fs_delete", args: {}, summary: "Delete one file" },
    });
    expect(builder.snapshot(1_500)).toMatchObject({
      lifecycle: "awaiting_approval",
      outcome: "unverified",
      rootCause: "known",
    });

    builder.observe({
      kind: "approval_resolved",
      payload: { id: "approval-1", status: "denied" },
    });
    expect(builder.snapshot(1_700)).toMatchObject({
      lifecycle: "blocked",
      outcome: "failed",
      rootCause: "known",
    });
  });

  it("reports a runtime failure and sanitizes secrets from diagnostics", () => {
    const builder = new TaskReceiptBuilder({
      taskId: "task-secret",
      objective: "Use OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz123456",
      mode: "action",
      startedAt: 1_000,
    });
    const receipt = observe(
      builder,
      {
        kind: "error",
        payload: { message: "request failed with sk-proj-abcdefghijklmnopqrstuvwxyz123456" },
      },
    );

    expect(receipt).toMatchObject({ lifecycle: "failed", outcome: "failed", rootCause: "likely" });
    expect(JSON.stringify(receipt)).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    expect(JSON.stringify(receipt)).toContain("sk-***");
  });

  it("reports cancellation without pretending partial progress completed the task", () => {
    const receipt = observe(
      build(),
      { kind: "tool_call", payload: { tool: "fs_read", args: {} } },
      { kind: "tool_result", payload: { tool: "fs_read", ok: true, result: "read" } },
      { kind: "killed", payload: { reason: "manual" } },
    );
    expect(receipt).toMatchObject({
      lifecycle: "cancelled",
      outcome: "partial",
      rootCause: "known",
    });
  });

  it("marks an explicit local file failure known and removes ANSI escapes", () => {
    const receipt = observe(
      build(),
      { kind: "tool_call", payload: { tool: "fs_read", args: {} } },
      { kind: "tool_result", payload: {
        tool: "fs_read",
        ok: false,
        result: "\u001b[2mENOENT: no such file or directory\u001b[0m",
      } },
      { kind: "final", payload: { text: "The file does not exist." } },
      { kind: "done", payload: {} },
    );
    expect(receipt.rootCause).toBe("known");
    expect(JSON.stringify(receipt)).not.toMatch(/\[(?:2|0)m/);
  });

  it("separates verified response delivery from an unverified action outcome", () => {
    const receipt = observe(
      build("action"),
      { kind: "final", payload: { text: "Here is the explanation." } },
      { kind: "done", payload: {} },
    );
    expect(receipt).toMatchObject({
      lifecycle: "finished",
      outcome: "unverified",
      verificationScope: "response_delivery",
      lastVerifiedStage: "The final response reached this conversation.",
    });
  });

  it("keeps the request and newest evidence when a long run exceeds the receipt limit", () => {
    const builder = build();
    for (let index = 0; index < 10; index += 1) {
      builder.observe({
        kind: "tool_result",
        payload: { tool: `tool_${index}`, ok: true, result: "ok" },
      });
    }
    builder.observe({ kind: "final", payload: { text: "Done." } });
    builder.observe({ kind: "done", payload: {} });

    const receipt = builder.snapshot(2_000);
    expect(receipt.evidence).toHaveLength(8);
    expect(receipt.evidence[0]?.label).toBe("Request accepted");
    expect(receipt.evidence.at(-1)?.label).toBe("Response delivered");
  });
});
