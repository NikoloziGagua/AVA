import { describe, expect, it } from "vitest";
import type { TaskReceipt } from "../receipts/task-receipt.js";
import { learningEvidenceFromReceipt, learningOutcomeFromReceipt } from "./learning.js";

function receipt(patch: Partial<TaskReceipt> = {}): TaskReceipt {
  return {
    schemaVersion: 2,
    taskId: "task-learning",
    expected: "Write a file",
    actual: "The file was written.",
    lifecycle: "finished",
    outcome: "verified",
    verificationScope: "task_outcome",
    verificationMethod: "fs_readback",
    verificationObservedAt: 1_500,
    lastVerifiedStage: "The file matched.",
    observationPoint: null,
    rootCause: "not_applicable",
    recoveryAction: null,
    evidence: [],
    toolCalls: 1,
    successfulToolResults: 1,
    uncertainToolResults: 0,
    failedToolResults: 0,
    startedAt: 1_000,
    updatedAt: 2_000,
    durationMs: 1_000,
    ...patch,
  };
}

describe("playbook learning receipt gate", () => {
  it.each([
    ["verified", "verified"],
    ["partial", "partially_verified"],
    ["unverified", "unverified"],
    ["contradicted", "contradicted"],
    ["failed", "failed"],
  ] as const)("maps %s receipt evidence to %s learning", (outcome, expected) => {
    expect(learningOutcomeFromReceipt(receipt({ outcome }))).toBe(expected);
  });

  it("keeps cancellation and approval blocks neutral", () => {
    expect(learningOutcomeFromReceipt(receipt({ lifecycle: "cancelled", outcome: "partial" })))
      .toBe("unverified");
    expect(learningOutcomeFromReceipt(receipt({ lifecycle: "blocked", outcome: "failed" })))
      .toBe("unverified");
  });

  it("does not treat conversational response delivery as procedural proof", () => {
    expect(learningOutcomeFromReceipt(receipt({ verificationScope: "response_delivery" })))
      .toBe("not_applicable");
  });

  it("keeps only bounded provenance needed to audit the decision", () => {
    expect(learningEvidenceFromReceipt(receipt())).toEqual({
      taskId: "task-learning",
      method: "fs_readback",
      observedAt: 1_500,
    });
  });
});
