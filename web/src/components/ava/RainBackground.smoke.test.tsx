// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { RainBackground } from "./RainBackground.js";

describe("RainBackground", () => {
  it("renders calm + charged without crashing", () => {
    const calm = render(<RainBackground />);
    expect((calm.container.firstChild as HTMLElement).getAttribute("aria-hidden")).toBe("true");
    const charged = render(<RainBackground charged />);
    expect(charged.container.firstChild).toBeTruthy();
  });
});
