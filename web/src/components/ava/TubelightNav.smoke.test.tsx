// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Plus, List, Brain } from "lucide-react";
import { TubelightNav } from "./TubelightNav.js";

describe("TubelightNav", () => {
  it("renders all items and fires onSelect on click", () => {
    const onNew = vi.fn();
    const onChats = vi.fn();
    render(
      <TubelightNav
        activeName="New"
        items={[
          { name: "New", icon: Plus, onSelect: onNew },
          { name: "Chats", icon: List, onSelect: onChats },
          { name: "Memory", icon: Brain, onSelect: () => {} },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "New" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Chats" }));
    expect(onChats).toHaveBeenCalledOnce();
    expect(onNew).not.toHaveBeenCalled();
  });
});
