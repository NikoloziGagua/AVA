// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DisplayCards } from "./DisplayCards.js";

describe("DisplayCards", () => {
  it("exports a function component", () => {
    expect(typeof DisplayCards).toBe("function");
  });

  it("renders the pinned cards and fires onOpen / onUnpin", () => {
    const onOpen = vi.fn();
    const onUnpin = vi.fn();
    render(
      <DisplayCards
        cards={[
          { id: "a", title: "Ground control", subtitle: "2h ago", onOpen, onUnpin },
        ]}
      />,
    );

    // Title is shown.
    expect(screen.getByText("Ground control")).toBeTruthy();

    // The lit star unpins (stopPropagation → does NOT also open).
    fireEvent.click(screen.getByRole("button", { name: "unpin" }));
    expect(onUnpin).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();

    // Clicking the card body opens the chat.
    fireEvent.click(screen.getByText("Ground control"));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("renders nothing when there are no cards", () => {
    const { container } = render(<DisplayCards cards={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
