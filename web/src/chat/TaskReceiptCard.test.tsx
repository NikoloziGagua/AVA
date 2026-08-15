// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { TaskReceiptCard } from "./TaskReceiptCard.js";
import type { TaskReceipt } from "./task-receipt.js";

afterEach(() => cleanup());

const base: TaskReceipt = {
  schemaVersion: 1,
  taskId: "task-visible-123",
  expected: "Open the requested page",
  actual: "AVA returned a response, but the requested external outcome was not independently verified.",
  lifecycle: "finished",
  outcome: "unverified",
  verificationScope: "operational_steps",
  lastVerifiedStage: "chrome navigate returned a successful operational result.",
  observationPoint: "Evidence stopped at the tool-result boundary; no independent outcome verifier ran.",
  rootCause: "unknown",
  recoveryAction: "Check the real result before relying on it, or ask AVA to verify it explicitly.",
  evidence: [
    {
      kind: "request",
      label: "Request accepted",
      detail: "AVA created an agent run for this request.",
      strength: "verified",
    },
    {
      kind: "tool_result",
      label: "chrome navigate reported success",
      detail: "The executor returned successfully. This does not by itself verify an external outcome.",
      strength: "observed",
    },
  ],
  toolCalls: 1,
  successfulToolResults: 1,
  uncertainToolResults: 0,
  failedToolResults: 0,
  startedAt: 1_000,
  updatedAt: 2_500,
  durationMs: 1_500,
};

describe("TaskReceiptCard", () => {
  it("shows the outcome, last proven stage, and uncertainty boundary in the compact view", () => {
    render(<TaskReceiptCard receipt={base} />);
    const card = screen.getByTestId("task-receipt");
    expect(within(card).getByText("Unverified")).toBeTruthy();
    expect(within(card).getByText(/Last proven:/)).toBeTruthy();
    expect(within(card).getByText(/Evidence changed here:/)).toBeTruthy();
  });

  it("expands into expected-versus-actual, evidence, recovery, and diagnostic ID", () => {
    render(<TaskReceiptCard receipt={base} />);
    fireEvent.click(screen.getByText("Task receipt"));
    expect(screen.getByText("Expected")).toBeTruthy();
    expect(screen.getByText("Open the requested page")).toBeTruthy();
    expect(screen.getByText("Evidence trail")).toBeTruthy();
    expect(screen.getByText(/Check the real result/)).toBeTruthy();
    expect(screen.getByText(/ID task-visible-123/)).toBeTruthy();
  });

  it("keeps lifecycle and outcome quality as separate visible labels", () => {
    render(<TaskReceiptCard receipt={{ ...base, lifecycle: "blocked", outcome: "failed" }} />);
    expect(screen.getByText("Blocked")).toBeTruthy();
    expect(screen.getByText("Failed")).toBeTruthy();
  });

  it("labels response delivery without claiming the task outcome was verified", () => {
    render(<TaskReceiptCard receipt={{
      ...base,
      outcome: "unverified",
      verificationScope: "response_delivery",
      observationPoint: "No independently verifiable action boundary was observed.",
    }} />);
    expect(screen.getByText("Response delivered")).toBeTruthy();
    expect(screen.queryByText("Verified")).toBeNull();
  });

  it("shows contradiction and its verification method explicitly", () => {
    render(<TaskReceiptCard receipt={{
      ...base,
      schemaVersion: 2,
      outcome: "contradicted",
      verificationScope: "task_outcome",
      verificationMethod: "fs_readback",
      actual: "Post-action verification contradicted the executor report.",
      observationPoint: "The bytes read back did not match.",
      rootCause: "known",
      evidence: [{
        kind: "verification",
        label: "fs write verification contradicted the result",
        detail: "The bytes read back did not match.",
        strength: "verified",
        method: "fs_readback",
      }],
    }} />);
    expect(screen.getByText("Contradicted")).toBeTruthy();
    fireEvent.click(screen.getByText("Task receipt"));
    expect(screen.getByText(/fs_readback/)).toBeTruthy();
  });
});
