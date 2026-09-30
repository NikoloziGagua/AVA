// @vitest-environment jsdom
// Day dividers and the voice mark (contract one-conversation v1, Phase A).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MessageList, dayBreaks, dayLabel, dublinDay, type ChatMessage } from "./MessageList.js";

afterEach(cleanup);

describe("Dublin days", () => {
  // 28 Sep 2026 is Irish Summer Time (UTC+1): 23:30 UTC is already the 29th in Dublin.
  it("uses the Dublin date, not UTC", () => {
    expect(dublinDay(Date.parse("2026-09-28T23:30:00Z"))).toBe("2026-09-29");
    expect(dublinDay(Date.parse("2026-12-01T23:30:00Z"))).toBe("2026-12-01");
  });

  it("labels today, yesterday and older days", () => {
    const now = Date.parse("2026-09-28T10:00:00Z");
    expect(dayLabel(Date.parse("2026-09-28T06:00:00Z"), now)).toBe("Today");
    expect(dayLabel(Date.parse("2026-09-27T12:00:00Z"), now)).toBe("Yesterday");
    expect(dayLabel(Date.parse("2026-09-25T12:00:00Z"), now)).toMatch(/^Fri 25 Sep/);
  });

  it("knows yesterday across the October clock change", () => {
    // Clocks go back on 25 Oct 2026; the 26th's yesterday is the 25th.
    expect(dayLabel(Date.parse("2026-10-25T20:00:00Z"), Date.parse("2026-10-26T08:00:00Z"))).toBe("Yesterday");
  });

  it("puts a divider only where the dated day changes", () => {
    const now = Date.parse("2026-09-28T10:00:00Z");
    const history: ChatMessage[] = [
      { id: "a", role: "user", text: "1", createdAt: Date.parse("2026-09-27T09:00:00Z") },
      { id: "b", role: "assistant", text: "2", createdAt: Date.parse("2026-09-27T09:01:00Z") },
      { id: "c", role: "user", text: "3", createdAt: Date.parse("2026-09-28T08:00:00Z") },
      { id: "d", role: "assistant", text: "4" }, // live reply: no date of its own
      { id: "e", role: "user", text: "5", createdAt: Date.parse("2026-09-28T09:00:00Z") },
    ];
    expect([...dayBreaks(history, now)]).toEqual([["a", "Yesterday"], ["c", "Today"]]);
  });
});

describe("MessageList", () => {
  it("renders day dividers as headings and marks only spoken turns", () => {
    vi.setSystemTime(Date.parse("2026-09-28T10:00:00Z"));
    Element.prototype.scrollIntoView = vi.fn();
    const history: ChatMessage[] = [
      { id: "s-1", role: "user", text: "spoken", createdAt: Date.parse("2026-09-27T09:00:00Z"), inputModality: "voice" },
      { id: "s-2", role: "user", text: "typed", createdAt: Date.parse("2026-09-28T09:00:00Z"), inputModality: "text" },
      { id: "s-3", role: "user", text: "exact", createdAt: Date.parse("2026-09-28T09:05:00Z"), inputModality: "text", inputSource: "voice_exact_text" },
    ];
    render(<MessageList history={history} liveEvents={[]} />);
    expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual(["Yesterday", "Today"]);
    expect(screen.getAllByText("Said")).toHaveLength(1);
    expect(screen.getByText("Exact text · entered in voice")).toBeTruthy();
    vi.useRealTimers();
  });
});
