// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { SelfScreen } from "./SelfScreen.js";

afterEach(() => {
  cleanup();
  hooked.paused = false;
  hooked.improve.mockClear();
  hooked.setPaused.mockClear();
});

const hooked = vi.hoisted(() => ({
  paused: false,
  improve: vi.fn(async (_goal: string) => ({ ok: true as boolean, error: undefined as string | undefined })),
  setPaused: vi.fn(),
}));

vi.mock("./useSelfJournal.js", () => ({
  useSelfJournal: () => ({
    intents: [
      { id: "i1", goal: "be faster", status: "swapped", outcome: "shipped" },
      { id: "i2", goal: "in progress thing", status: "implementing" },
      { id: "i3", goal: "gated thing", status: "awaiting_approval", diff_summary: "PLAN:\nCHANGE: edit foo.ts" },
    ],
    paused: hooked.paused,
    setPaused: hooked.setPaused,
    improve: hooked.improve,
    revertLast: vi.fn(),
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

  it("renders the improvement initiator and calls improve on submit, clearing the input", async () => {
    render(<SelfScreen onClose={() => {}} />);
    const input = screen.getByPlaceholderText(/tell ava what to improve/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "answer with fewer words" } });
    fireEvent.submit(screen.getByRole("form", { name: /start a self-improvement/i }));
    await waitFor(() => expect(hooked.improve).toHaveBeenCalledWith("answer with fewer words"));
    await waitFor(() => expect(input.value).toBe(""));
  });

  it("keeps the goal and shows an inline error when improve fails (e.g. 409 paused)", async () => {
    hooked.improve.mockResolvedValueOnce({ ok: false, error: "self-improvement is paused — resume it first" });
    render(<SelfScreen onClose={() => {}} />);
    const input = screen.getByPlaceholderText(/tell ava what to improve/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "do a thing" } });
    fireEvent.submit(screen.getByRole("form", { name: /start a self-improvement/i }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/paused — resume/i),
    );
    expect(input.value).toBe("do a thing");
  });

  it("pause toggle calls setPaused with the flipped value", () => {
    render(<SelfScreen onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /^pause$/i }));
    expect(hooked.setPaused).toHaveBeenCalledWith(true);
  });

  it("shows a PAUSED chip near the journal (and a Resume button) while paused", () => {
    hooked.paused = true;
    render(<SelfScreen onClose={() => {}} />);
    expect(screen.getByRole("button", { name: /resume/i })).toBeTruthy();
    // Controls chip + journal indicator both read PAUSED.
    expect(screen.getAllByText("PAUSED").length).toBeGreaterThanOrEqual(2);
  });
});
