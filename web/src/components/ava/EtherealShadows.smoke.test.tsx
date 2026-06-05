// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { EtherealShadows } from "./EtherealShadows.js";

describe("EtherealShadows", () => {
  it("renders calm + charged without crashing", () => {
    const calm = render(<EtherealShadows />);
    expect((calm.container.firstChild as HTMLElement).getAttribute("aria-hidden")).toBe("true");
    const charged = render(<EtherealShadows charged />);
    expect(charged.container.firstChild).toBeTruthy();
  });

  it("mounts the displacement filter when motion is allowed", () => {
    // jsdom defaults prefers-reduced-motion to no-preference → animated path
    const { container } = render(<EtherealShadows />);
    expect(container.querySelector("filter feDisplacementMap")).toBeTruthy();
    expect(container.querySelector("filter feTurbulence animate")).toBeTruthy();
  });
});
