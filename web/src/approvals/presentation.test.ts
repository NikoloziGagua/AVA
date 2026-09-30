import { describe, expect, it } from "vitest";
import {
  approvalTiming,
  pendingApprovalCopy,
  resolvedApprovalCopy,
} from "./presentation.js";

describe("approval presentation", () => {
  it("derives countdown state from the server deadline rather than mount time", () => {
    const timing = approvalTiming({ deadlineAt: 25_000, timeoutMs: 15_000 }, 19_400);
    expect(timing.remainingSeconds).toBe(6);
    expect(timing.progressPercent).toBeCloseTo(37.333, 2);
    expect(timing.deadlineReached).toBe(false);
  });

  it("keeps medium and high timeout outcomes distinct", () => {
    const timing = approvalTiming({ deadlineAt: 25_000, timeoutMs: 15_000 }, 20_000);
    expect(pendingApprovalCopy({ timeoutBehavior: "auto_approve" }, timing))
      .toBe("Auto-approving in 5s — cancel to stop.");
    expect(pendingApprovalCopy({ timeoutBehavior: "auto_deny" }, timing))
      .toBe("Auto-denying in 5s — approve now to run.");
  });

  it("uses neutral copy when retained evidence lacks policy metadata", () => {
    const timing = approvalTiming({}, 20_000);
    expect(pendingApprovalCopy({}, timing)).toBe("Waiting for the server's approval decision.");
    expect(resolvedApprovalCopy("expired", {})).toBe("Expired · action did not run.");
  });

  it("states denied and risk-aware expired terminal outcomes without implying execution", () => {
    expect(resolvedApprovalCopy("denied", { riskTier: "medium" }))
      .toBe("Denied · action did not run.");
    expect(resolvedApprovalCopy("expired", { riskTier: "high" }))
      .toBe("Not approved · high-risk action did not run.");
    expect(resolvedApprovalCopy("expired", { riskTier: "medium" }))
      .toBe("Cancelled or expired · action did not run.");
  });
});
