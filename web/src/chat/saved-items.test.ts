import { describe, expect, it } from "vitest";
import { savedItemDestination } from "./saved-items.js";

describe("savedItemDestination", () => {
  it("opens notes and ideas exactly, reminders in Schedule, watches focused, memories in Memory", () => {
    expect(savedItemDestination({ kind: "note", id: "n1", title: "t" })).toEqual({ view: "notes", noteId: "n1" });
    expect(savedItemDestination({ kind: "idea", id: "n2", title: "t" })).toEqual({ view: "notes", noteId: "n2" });
    expect(savedItemDestination({ kind: "reminder", id: "w1", title: "t" })).toEqual({ view: "schedule" });
    expect(savedItemDestination({ kind: "watch", id: "w2", title: "t" })).toEqual({ view: "watches", watchId: "w2" });
    expect(savedItemDestination({ kind: "memory", id: "file:preferences", title: "t" })).toEqual({ view: "memory" });
  });
});
