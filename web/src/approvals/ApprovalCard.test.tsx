// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  approveApproval: vi.fn(async () => {}),
  denyApproval: vi.fn(async () => {}),
}));

vi.mock("../api.js", () => actions);

import { ApprovalCard } from "./ApprovalCard.js";

const base = {
  id: "approval-1",
  tool: "claude_code",
  args: { prompt: "bounded change" },
  summary: "Run a bounded change",
  resolvedStatus: null,
  requestedAt: 100_000,
  deadlineAt: 115_000,
  timeoutMs: 15_000,
} as const;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("ApprovalCard", () => {
  it("shows medium auto-approval truthfully and preserves keyboard-native actions", async () => {
    render(<ApprovalCard {...base} riskTier="medium" timeoutBehavior="auto_approve" />);

    expect(screen.getByRole("region", { name: "Approve this action?" })).toBeTruthy();
    expect(screen.getByText("Medium risk")).toBeTruthy();
    expect(screen.getByText("Silence auto-approves")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Auto-approving in 15s — cancel to stop.");
    expect(screen.getByRole("button", { name: "Cancel" }).tagName).toBe("BUTTON");
    expect(screen.getByRole("button", { name: "Approve now" }).tagName).toBe("BUTTON");

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cancel" })));
    expect(actions.denyApproval).toHaveBeenCalledWith("approval-1");
    expect(screen.getByRole("status").textContent).toBe("Submitting denial…");
  });

  it("shows high-risk auto-denial and a truthful expired terminal state", () => {
    const view = render(<ApprovalCard {...base} riskTier="high" timeoutBehavior="auto_deny" />);
    expect(screen.getByRole("region", { name: "Approve this high-risk action?" })).toBeTruthy();
    expect(screen.getByText("High risk")).toBeTruthy();
    expect(screen.getByText("Silence auto-denies")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Auto-denying in 15s — approve now to run.");

    act(() => vi.advanceTimersByTime(15_000));
    expect(screen.getByRole("status").textContent).toBe("Auto-deny deadline reached — waiting for server confirmation.");

    view.rerender(<ApprovalCard {...base} riskTier="high" timeoutBehavior="auto_deny" resolvedStatus="expired" />);
    expect(screen.getByRole("status").textContent).toContain("Not approved · high-risk action did not run.");
    expect(screen.queryByText(/Auto-approving/)).toBeNull();
  });

  it("submits an explicit approval without resolving optimistically", async () => {
    render(<ApprovalCard {...base} riskTier="high" timeoutBehavior="auto_deny" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Approve now" })));
    expect(actions.approveApproval).toHaveBeenCalledWith("approval-1");
    expect(screen.getByRole("status").textContent).toBe("Submitting approval…");
    expect(screen.getByTestId("approval-card")).toBeTruthy();
  });

  it("continues the same absolute countdown after a reconnect-style remount", () => {
    const first = render(<ApprovalCard {...base} riskTier="medium" timeoutBehavior="auto_approve" />);
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.getByRole("status").textContent).toBe("Auto-approving in 10s — cancel to stop.");
    first.unmount();

    render(<ApprovalCard {...base} riskTier="medium" timeoutBehavior="auto_approve" />);
    expect(screen.getByRole("status").textContent).toBe("Auto-approving in 10s — cancel to stop.");
  });

  it("does not guess the policy for a legacy event", () => {
    render(<ApprovalCard {...base} deadlineAt={undefined} timeoutMs={undefined} requestedAt={undefined} />);
    expect(screen.getByText("Risk not recorded")).toBeTruthy();
    expect(screen.getByText("Timeout behavior not recorded")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Waiting for the server's approval decision.");
    expect(screen.queryByText(/Auto-approv|Auto-deny/)).toBeNull();
  });
});
