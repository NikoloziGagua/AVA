// @vitest-environment jsdom
// "Learned workflows" smoke: playbooks render (trigger + stat row + stakes chip),
// expand to steps/lessons, and the empty/error states show a quiet one-liner.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

const fetchPlaybooks = vi.fn();
vi.mock("../api.js", () => ({
  fetchPlaybooks: (...a: unknown[]) => fetchPlaybooks(...a),
}));

import { PlaybooksSection, playbookStatLine } from "./PlaybooksSection.js";
import type { PlaybookRow } from "../api.js";

const pb = (over: Partial<PlaybookRow> = {}): PlaybookRow => ({
  slug: "morning-brief",
  trigger: "compile the morning brief",
  keywords: ["brief", "morning"],
  created: "2026-06-01",
  last_used: "2026-07-01",
  uses: 12,
  stakes: "routine",
  steps: ["open the dashboard", "summarize overnight alerts"],
  version: 3,
  succ: 10,
  fail: 2,
  avg_secs: 42.4,
  lessons: ["skip the ads tab — it stalls the scrape"],
  ...over,
});

beforeEach(() => {
  // Static rendering: the chevron morph gsap.set()s instead of tweening.
  localStorage.setItem("ava-motion", "reduced");
  fetchPlaybooks.mockReset();
});

afterEach(() => cleanup());

describe("PlaybooksSection", () => {
  it("renders playbooks: trigger, stat row, stakes chips; expands to steps + lessons", async () => {
    fetchPlaybooks.mockResolvedValue([
      pb(),
      pb({
        slug: "deploy-site",
        trigger: "deploy the site",
        stakes: "consequential",
        uses: 1, version: 1, succ: 1, fail: 0, avg_secs: 8,
        lessons: [],
      }),
    ]);
    render(<PlaybooksSection />);

    expect(await screen.findByText("compile the morning brief")).toBeTruthy();
    expect(screen.getByText("deploy the site")).toBeTruthy();
    // Stat rows: v{version} · used {uses}× · {succ}W/{fail}L · ~{avg_secs}s
    expect(screen.getByText("v3 · used 12× · 10W/2L · ~42s")).toBeTruthy();
    expect(screen.getByText("v1 · used 1× · 1W/0L · ~8s")).toBeTruthy();
    // Stakes chips: consequential = warning chip; routine = quiet label.
    expect(screen.getByText("CONSEQUENTIAL")).toBeTruthy();
    expect(screen.getByText("routine")).toBeTruthy();

    // Collapsed by default — steps hidden until the row is expanded.
    expect(screen.queryByText("open the dashboard")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /compile the morning brief/ }));
    expect(screen.getByText("open the dashboard")).toBeTruthy();
    expect(screen.getByText("summarize overnight alerts")).toBeTruthy();
    expect(screen.getByText("skip the ads tab — it stalls the scrape")).toBeTruthy();
  });

  it("shows the empty state when nothing has been learned yet", async () => {
    fetchPlaybooks.mockResolvedValue([]);
    render(<PlaybooksSection />);
    expect(await screen.findByText(/Nothing learned yet/)).toBeTruthy();
  });

  it("surfaces a fetch error", async () => {
    fetchPlaybooks.mockRejectedValue(new Error("boom"));
    render(<PlaybooksSection />);
    expect(await screen.findByText(/error: .*boom/)).toBeTruthy();
  });

  it("playbookStatLine formats the vitals and defaults missing fields", () => {
    expect(playbookStatLine(pb())).toBe("v3 · used 12× · 10W/2L · ~42s");
    expect(playbookStatLine({} as PlaybookRow)).toBe("v1 · used 0× · 0W/0L · ~0s");
  });
});
