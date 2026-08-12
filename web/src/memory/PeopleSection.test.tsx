// @vitest-environment jsdom
// "People" smoke: people render (name + aliases + IG/WA identity chips + notes),
// the ✓ prior-verification badge appears only when an Instagram thread was observed,
// the empty state shows a quiet one-liner, and hand-grown JSON with missing
// fields degrades instead of crashing.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const fetchPeople = vi.fn();
vi.mock("../api.js", () => ({
  fetchPeople: (...a: unknown[]) => fetchPeople(...a),
}));

import { PeopleSection } from "./PeopleSection.js";
import type { PersonRow } from "../api.js";

const person = (over: Partial<PersonRow> = {}): PersonRow => ({
  id: "p1",
  name: "Lasha",
  aliases: ["lashiko", "the weird one"],
  instagram: { username: "weird_username_123", threadId: "t-991" },
  whatsapp: { username: "Lasha K", phone: "+995599123456" },
  notes: "childhood friend — prefers voice notes",
  updated: "2026-07-01",
  ...over,
});

beforeEach(() => {
  // Static rendering: hover lifts gsap.set() instead of tweening.
  localStorage.setItem("ava-motion", "reduced");
  fetchPeople.mockReset();
});

afterEach(() => cleanup());

describe("PeopleSection", () => {
  it("renders people: name, aliases, IG/WA chips, thread badge, notes", async () => {
    fetchPeople.mockResolvedValue([
      person(),
      person({
        id: "p2",
        name: "Nino",
        aliases: [],
        instagram: { username: "nino_arts" }, // no threadId → no ✓ badge
        whatsapp: { phone: "+995555000111" }, // no username → phone label
        notes: undefined,
        updated: "2026-06-20",
      }),
    ]);
    render(<PeopleSection />);

    // Names (titles) + quiet alias line.
    expect(await screen.findByText("Lasha")).toBeTruthy();
    expect(screen.getByText("Nino")).toBeTruthy();
    expect(screen.getByText("aka lashiko, the weird one")).toBeTruthy();

    // App identity chips: IG @username and WA <name or phone>.
    expect(screen.getByText("IG @weird_username_123")).toBeTruthy();
    expect(screen.getByText("IG @nino_arts")).toBeTruthy();
    expect(screen.getByText("WA Lasha K")).toBeTruthy();
    expect(screen.getByText("WA +995555000111")).toBeTruthy();

    // Prior-verification badge ONLY where instagram.threadId is present.
    expect(screen.getAllByLabelText("previously verified thread")).toHaveLength(1);
    expect(screen.getByText("✓")).toBeTruthy();

    // Notes line + count chip.
    expect(screen.getByText("childhood friend — prefers voice notes")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("shows the empty state when the people map is empty", async () => {
    fetchPeople.mockResolvedValue([]);
    render(<PeopleSection />);
    expect(
      await screen.findByText(/No people yet — tell Ava who your people are/),
    ).toBeTruthy();
  });

  it("renders defensively: missing aliases/apps/notes/updated do not crash", async () => {
    fetchPeople.mockResolvedValue([
      // Bare-minimum row: no aliases array, no apps, no notes, no updated.
      { id: "px", name: "Guram" } as PersonRow,
      // Instagram known only by thread id (no username), whatsapp empty object.
      {
        id: "py",
        name: "Keti",
        aliases: [null, "", "keti-chan"] as unknown as string[],
        instagram: { threadId: "t-777" },
        whatsapp: {},
        updated: "2026-05-05",
      } as PersonRow,
    ]);
    render(<PeopleSection />);

    expect(await screen.findByText("Guram")).toBeTruthy();
    expect(screen.getByText("Keti")).toBeTruthy();
    // Bogus alias entries filtered; the real one survives.
    expect(screen.getByText("aka keti-chan")).toBeTruthy();
    // Thread-only Instagram still shows a bare IG chip with the ✓ badge.
    expect(screen.getByText("IG")).toBeTruthy();
    expect(screen.getAllByLabelText("previously verified thread")).toHaveLength(1);
    // Empty whatsapp object → no WA chip at all.
    expect(screen.queryByText(/^WA /)).toBeNull();
  });

  it("surfaces a fetch error", async () => {
    fetchPeople.mockRejectedValue(new Error("boom"));
    render(<PeopleSection />);
    expect(await screen.findByText(/error: .*boom/)).toBeTruthy();
  });
});
