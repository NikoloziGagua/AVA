import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InitiativeView } from "./api.js";
import { IdeaUnavailable, InvitationNav, InvitationPanel } from "./InvitationPanel.js";

afterEach(() => { cleanup(); });

// Tuesday 29 September 2026, 14:00 in Dublin.
const CALL_AT = Date.parse("2026-09-29T13:00:00Z");

function view(overrides: Partial<InitiativeView> = {}): InitiativeView {
  return {
    id: "ini_1",
    sessionId: "s_1",
    title: "Pricing test as proof",
    reasonNow: "You saved new landing page ideas yesterday.",
    scope: { kind: "project", folderId: "f_acme", name: "Acme" },
    publishedAt: 1,
    expiresAt: 2,
    openedAt: 1,
    disposition: { state: "open", version: 1, updatedAt: 1 },
    notification: { state: "accepted" },
    sources: [
      { type: "note", id: "n_1", status: "current", title: "Landing page ideas" },
      { type: "calendar_occurrence", occurrenceKey: "e_1:2026-09-29", status: "current", title: "Investor call", startsAt: CALL_AT, endsAt: CALL_AT + 3_600_000 },
      { type: "note", id: "n_2", status: "unavailable", title: null },
    ],
    ...overrides,
  };
}

function panel(overrides: Partial<Parameters<typeof InvitationPanel>[0]> = {}) {
  const props = {
    state: { status: "open" as const, view: view(), position: null },
    notice: null,
    busy: false,
    onTalk: vi.fn(),
    onLater: vi.fn(),
    onNotUseful: vi.fn(),
    onOpenNote: vi.fn(),
    onOpenCalendarAt: vi.fn(),
    ...overrides,
  };
  render(<InvitationPanel {...props} />);
  return props;
}

describe("InvitationPanel", () => {
  it("says why now, links each source to its exact place, and offers three answers", () => {
    const props = panel();
    expect(screen.getByText("You saved new landing page ideas yesterday.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open note: Landing page ideas" }));
    expect(props.onOpenNote).toHaveBeenCalledWith("n_1");
    fireEvent.click(screen.getByRole("button", { name: /^Open in Calendar: Investor call · Tue 29 Sept?,? 14:00$/ }));
    expect(props.onOpenCalendarAt).toHaveBeenCalledWith(CALL_AT, "e_1:2026-09-29");
    const gone = screen.getByRole("button", { name: "No longer available" }) as HTMLButtonElement;
    expect(gone.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Let's talk" }));
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    fireEvent.click(screen.getByRole("button", { name: "Not useful" }));
    expect(props.onTalk).toHaveBeenCalledTimes(1);
    expect(props.onLater).toHaveBeenCalledTimes(1);
    expect(props.onNotUseful).toHaveBeenCalledTimes(1);
  });

  it("keeps a source edited since AVA wrote the idea openable, and says so", () => {
    const props = panel({
      state: {
        status: "open",
        view: view({ sources: [
          { type: "note", id: "n_3", status: "changed", title: "Pricing test" },
          { type: "calendar_occurrence", occurrenceKey: "e_1:2026-09-29", status: "changed", title: "Investor call", startsAt: CALL_AT, endsAt: CALL_AT + 3_600_000 },
        ] }),
        position: null,
      },
    });
    const note = screen.getByRole("button", { name: "Open note: Pricing test. Changed since AVA wrote this" });
    expect(note.textContent).toContain("Changed since AVA wrote this");
    fireEvent.click(note);
    expect(props.onOpenNote).toHaveBeenCalledWith("n_3");
    expect(screen.getByRole("button", { name: /^Open in Calendar: Investor call · .+\. Changed since AVA wrote this$/ })).toBeTruthy();
  });

  it("shows a Later answer as saved, and holds the answers while one is saving", () => {
    panel({ state: { status: "open", view: view({ disposition: { state: "later", version: 2, updatedAt: 2 } }), position: null } });
    const saved = screen.getByRole("button", { name: "Saved for later" }) as HTMLButtonElement;
    expect(saved.disabled).toBe(true);
    expect(saved.getAttribute("aria-pressed")).toBe("true");
    cleanup();
    panel({ busy: true });
    expect((screen.getByRole("button", { name: "Not useful" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps a finished idea readable without answers", () => {
    panel({ state: { status: "closed", view: view(), reason: "expired" } });
    expect(screen.getByText("This idea has expired. You can still reply to it.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Later" })).toBeNull();
    expect(screen.queryByText(/Why now/)).toBeNull();
    cleanup();
    panel({ state: { status: "closed", view: view(), reason: "not_useful" }, notice: "Marked not useful. AVA will take that into account." });
    expect(screen.getByRole("status").textContent).toBe("Marked not useful. AVA will take that into account.");
    expect(screen.queryByText("You marked this idea not useful.")).toBeNull();
  });
});

describe("InvitationNav", () => {
  it("moves to the newer and older idea from the inbox", () => {
    const onOpen = vi.fn();
    const newer = { sessionId: "s_0", initiativeId: "ini_0" };
    render(<InvitationNav position={{ index: 2, total: 3, newer, older: null }} onOpen={onOpen} />);
    expect(screen.getByText("Idea 2 of 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Newer idea" }));
    expect(onOpen).toHaveBeenCalledWith(newer);
    expect((screen.getByRole("button", { name: "Older idea" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("IdeaUnavailable", () => {
  it("says so in place and offers a way on", () => {
    const onOpenList = vi.fn();
    render(<IdeaUnavailable onOpenList={onOpenList} />);
    expect(screen.getByRole("alert").textContent).toContain("This idea is no longer available.");
    fireEvent.click(screen.getByRole("button", { name: "Your conversations" }));
    expect(onOpenList).toHaveBeenCalled();
  });
});
