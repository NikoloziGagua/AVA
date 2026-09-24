import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SavedItemsCard } from "./SavedItemsCard.js";

afterEach(() => cleanup());

const saved = {
  schemaVersion: 1 as const,
  items: [
    { kind: "note" as const, id: "n1", title: "Groceries" },
    { kind: "memory" as const, id: "file:preferences", title: "Prefers tea" },
  ],
};

describe("SavedItemsCard", () => {
  it("names each saved item with its kind and opens it on click or keyboard", () => {
    const onOpen = vi.fn();
    render(<SavedItemsCard saved={saved} onOpen={onOpen} />);
    expect(screen.getByRole("region", { name: "Saved by AVA" })).toBeTruthy();
    expect(screen.getByText("Note")).toBeTruthy();
    expect(screen.getByText("Memory")).toBeTruthy();
    const memory = screen.getByRole("button", { name: "Open memory: Prefers tea" });
    memory.focus();
    expect(document.activeElement).toBe(memory);
    fireEvent.click(memory);
    expect(onOpen).toHaveBeenCalledWith(saved.items[1]);
  });

  it("is a plain list when there is nowhere to open items", () => {
    render(<SavedItemsCard saved={saved} />);
    for (const button of screen.getAllByRole("button")) expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
