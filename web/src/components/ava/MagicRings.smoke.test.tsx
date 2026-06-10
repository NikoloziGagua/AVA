// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MagicRings } from "./MagicRings.js";

describe("MagicRings", () => {
  it("renders concentric rings (idle) without crashing", () => {
    const { container } = render(<MagicRings size={160} state="idle" />);
    expect(container.querySelectorAll("[data-ring]").length).toBe(4);
  });

  it("renders the listening state with amplitude without crashing", () => {
    const { container } = render(<MagicRings size={160} state="listening" amplitude={0.7} />);
    expect(container.querySelector("[data-ring-group]")).toBeTruthy();
  });

  it("renders the responding state without crashing", () => {
    const { container } = render(<MagicRings size={160} state="responding" />);
    expect(container.querySelector("svg")).toBeTruthy();
  });
});
