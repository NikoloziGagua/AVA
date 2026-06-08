// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SelfScreen } from "./SelfScreen.js";

afterEach(cleanup);

vi.mock("./useSelfJournal.js", () => ({
  useSelfJournal: () => ({
    intents: [
      { id: "i1", goal: "be faster", status: "swapped", outcome: "shipped" },
      { id: "i2", goal: "in progress thing", status: "implementing" },
      { id: "i3", goal: "gated thing", status: "awaiting_approval", diff_summary: "PLAN:\nCHANGE: edit foo.ts" },
    ],
    paused: false, setPaused: vi.fn(), revertLast: vi.fn(),
    cancel: vi.fn(), approve: vi.fn(), reject: vi.fn(),
  }),
  isRunningStatus: (s: string) => ["queued", "reflecting", "implementing", "verifying"].includes(s),
  planText: (s: string | null | undefined) => (s ?? "").replace(/^PLAN:\s*/, "").trim(),
}));

describe("SelfScreen", () => {
  it("renders the journal and a pause control", () => {
    render(<SelfScreen onClose={() => {}} />);
    expect(screen.getByText(/be faster/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /pause/i })).toBeTruthy();
  });

  it("shows a Stop button on a running self-improvement", () => {
    render(<SelfScreen onClose={() => {}} />);
    expect(screen.getByRole("button", { name: /stop/i })).toBeTruthy();
  });

  it("shows the plan and Approve/Reject on an awaiting_approval improvement", () => {
    render(<SelfScreen onClose={() => {}} />);
    expect(screen.getByText(/CHANGE: edit foo\.ts/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /approve & run/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /reject/i })).toBeTruthy();
  });
});
