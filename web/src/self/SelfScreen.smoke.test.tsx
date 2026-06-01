// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SelfScreen } from "./SelfScreen.js";

vi.mock("./useSelfJournal.js", () => ({
  useSelfJournal: () => ({
    intents: [{ id: "i1", goal: "be faster", status: "swapped", outcome: "shipped" }],
    paused: false, setPaused: vi.fn(), revertLast: vi.fn(),
  }),
}));

describe("SelfScreen", () => {
  it("renders the journal and a pause control", () => {
    render(<SelfScreen onClose={() => {}} />);
    expect(screen.getByText(/be faster/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /pause/i })).toBeTruthy();
  });
});
