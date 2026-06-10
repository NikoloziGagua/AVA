// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContainerScroll } from "./ContainerScroll.js";

describe("ContainerScroll", () => {
  it("exports a function component", () => {
    expect(typeof ContainerScroll).toBe("function");
  });

  it("mounts and renders its children", () => {
    render(
      <ContainerScroll>
        <div>strip content</div>
      </ContainerScroll>,
    );
    expect(screen.getByText("strip content")).toBeTruthy();
  });

  it("passes through className on the wrapper", () => {
    const { container } = render(
      <ContainerScroll className="my-wrap">
        <span>inner</span>
      </ContainerScroll>,
    );
    expect(container.querySelector(".my-wrap")).toBeTruthy();
    expect(screen.getByText("inner")).toBeTruthy();
  });
});
