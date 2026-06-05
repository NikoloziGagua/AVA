// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { WordReveal } from "./WordReveal.js";

describe("WordReveal", () => {
  it("renders the full text (words + spacing preserved)", () => {
    const { container } = render(<WordReveal text="open chrome and search" />);
    expect(container.textContent).toBe("open chrome and search");
  });

  it("splits into per-word spans so they can stagger in", () => {
    const { container } = render(<WordReveal text="hello there friend" />);
    // jsdom has no matchMedia → animated path → inline-block word spans
    const inlineBlocks = Array.from(container.querySelectorAll("span")).filter(
      (s) => (s as HTMLElement).style.display === "inline-block",
    );
    expect(inlineBlocks.length).toBe(3);
  });

  it("preserves newlines", () => {
    const { container } = render(<WordReveal text={"line one\nline two"} />);
    expect(container.textContent).toBe("line one\nline two");
  });
});
