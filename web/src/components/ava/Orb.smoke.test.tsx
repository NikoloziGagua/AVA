// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Orb } from "./Orb.js";

describe("Orb", () => {
  it("renders without crashing (idle)", () => {
    const { container } = render(<Orb size={80} state="idle" />);
    expect(container.firstChild).toBeTruthy();
  });

  it("renders the listening state (spawns ripples) without crashing", () => {
    const { container } = render(<Orb size={80} state="listening" amplitude={0.6} />);
    expect(container.querySelectorAll("[data-orb-ripple]").length).toBe(3);
  });

  it("carries a flip id for cross-surface continuity", () => {
    const { container } = render(<Orb flipId="ava-orb" />);
    expect((container.firstChild as HTMLElement).getAttribute("data-flip-id")).toBe("ava-orb");
  });
});
