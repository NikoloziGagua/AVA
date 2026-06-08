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
    ],
    paused: false, setPaused: vi.fn(), revertLast: vi.fn(), cancel: vi.fn(),
  }),
  isRunningStatus: (s: string) => ["queued", "reflecting", "implementing", "verifying"].includes(s),
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
});
