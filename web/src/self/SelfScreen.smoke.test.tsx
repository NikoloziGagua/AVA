// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { SelfScreen } from "./SelfScreen.js";

afterEach(() => {
  cleanup();
  hooked.paused = false;
  hooked.improve.mockClear();
  hooked.setPaused.mockClear();
  hooked.selectWorker.mockClear();
  hooked.codexAvailable = false;
});

const hooked = vi.hoisted(() => ({
  paused: false,
  improve: vi.fn(async (_goal: string) => ({ ok: true as boolean, error: undefined as string | undefined })),
  setPaused: vi.fn(),
  selectWorker: vi.fn(),
  codexAvailable: false,
}));

vi.mock("./useSelfJournal.js", () => ({
  useSelfJournal: () => ({
    intents: [
      { id: "i1", goal: "be faster", status: "swapped", outcome: "shipped", worker_provider: "claude" },
      { id: "i2", goal: "in progress thing", status: "implementing" },
      { id: "i3", goal: "gated thing", status: "awaiting_approval", diff_summary: "PLAN:\nCHANGE: edit foo.ts" },
      { id: "i4", goal: "stopped thing", status: "failed", outcome: "cancelled", error: "cancelled by global Stop", cancellation_source: "global_stop" },
    ],
    paused: hooked.paused,
    setPaused: hooked.setPaused,
    improve: hooked.improve,
    revertLast: vi.fn(),
    cancel: vi.fn(), approve: vi.fn(), reject: vi.fn(),
    worker: {
      provider: "claude", version: 1, updatedAt: 1,
      options: [
        { provider: "claude", label: "Claude Code", installed: true, configuration: "not_checked", available: true, version: "2.1", reason: null },
        { provider: "codex", label: "Codex", installed: hooked.codexAvailable, configuration: hooked.codexAvailable ? "not_checked" : "unavailable", available: hooked.codexAvailable, version: hooked.codexAvailable ? "0.147" : null, reason: hooked.codexAvailable ? null : "missing" },
      ],
    },
    workerError: null,
    selectingWorker: false,
    selectWorker: hooked.selectWorker,
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

  it("shows the selected worker, availability, and disables an unavailable option", () => {
    render(<SelfScreen onClose={() => {}} />);
    const claude = screen.getByRole("radio", { name: /claude code available/i });
    const codex = screen.getByRole("radio", { name: /codex unavailable/i });
    expect(claude.getAttribute("aria-checked")).toBe("true");
    expect((codex as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/no silent fallback/i)).toBeTruthy();
  });

  it("switches to an available worker through the explicit selector", () => {
    hooked.codexAvailable = true;
    render(<SelfScreen onClose={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: /codex available/i }));
    expect(hooked.selectWorker).toHaveBeenCalledWith("codex");
  });

  it("shows the plan and Approve/Reject on an awaiting_approval improvement", () => {
    render(<SelfScreen onClose={() => {}} />);
    expect(screen.getByText(/CHANGE: edit foo\.ts/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /approve & run with claude code/i })).toBeTruthy();
    expect(screen.getByText(/will lock claude code on approval/i)).toBeTruthy();
    expect(screen.getByText(/locks when you approve/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /reject/i })).toBeTruthy();
  });

  it("shows the real cancellation source in the journal", () => {
    render(<SelfScreen onClose={() => {}} />);
    expect(screen.getByText("cancelled by global Stop")).toBeTruthy();
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
