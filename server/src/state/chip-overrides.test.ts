import { describe, it, expect } from "vitest";
import { openInMemoryDb } from "./db.js";
import { createChip, listChips, updateChip, deleteChip, getChip } from "./chip-overrides.js";

function seedDevice(db: ReturnType<typeof openInMemoryDb>, id: string): void {
  db.prepare(
    "INSERT INTO device_tokens (id, token_hash, label, created_at) VALUES (?, ?, ?, ?)",
  ).run(id, `hash-${id}`, "test", Date.now());
}

describe("chip_overrides", () => {
  it("creates a pinned chip by default", () => {
    const db = openInMemoryDb();
    seedDevice(db, "d1");
    const c = createChip(db, "d1", { label: "Resume yesterday", prompt: "let's continue" });
    expect(c.pinned).toBe(1);
    expect(c.label).toBe("Resume yesterday");
    expect(c.prompt).toBe("let's continue");
  });

  it("listChips returns chips for the device only", () => {
    const db = openInMemoryDb();
    seedDevice(db, "d1");
    seedDevice(db, "d2");
    createChip(db, "d1", { label: "A", prompt: "a", position: 1 });
    createChip(db, "d1", { label: "B", prompt: "b", position: 2 });
    createChip(db, "d2", { label: "X", prompt: "x" });
    const list = listChips(db, "d1");
    expect(list).toHaveLength(2);
    expect(list.map((c) => c.label)).toEqual(["A", "B"]);
  });

  it("updateChip mutates label/prompt/pinned", () => {
    const db = openInMemoryDb();
    seedDevice(db, "d1");
    const c = createChip(db, "d1", { label: "old", prompt: "old prompt" });
    const updated = updateChip(db, c.id, { label: "new", pinned: false });
    expect(updated?.label).toBe("new");
    expect(updated?.pinned).toBe(0);
    expect(updated?.prompt).toBe("old prompt");
  });

  it("updateChip on missing id returns null", () => {
    const db = openInMemoryDb();
    expect(updateChip(db, "missing", { label: "x" })).toBeNull();
  });

  it("deleteChip removes the row", () => {
    const db = openInMemoryDb();
    seedDevice(db, "d1");
    const c = createChip(db, "d1", { label: "A", prompt: "a" });
    expect(deleteChip(db, c.id)).toBe(true);
    expect(getChip(db, c.id)).toBeNull();
  });

  it("deleteChip on missing id returns false", () => {
    const db = openInMemoryDb();
    expect(deleteChip(db, "missing")).toBe(false);
  });
});
