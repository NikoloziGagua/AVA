// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { NebulaBackground } from "./NebulaBackground.js";

describe("NebulaBackground", () => {
  it("renders a decorative, aria-hidden layer", () => {
    const { container } = render(<NebulaBackground />);
    const root = container.firstChild as HTMLElement;
    expect(root).toBeTruthy();
    expect(root.getAttribute("aria-hidden")).toBe("true");
  });
});
