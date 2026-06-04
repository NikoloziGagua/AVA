// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CommandBar } from "./CommandBar.js";

afterEach(cleanup);

describe("CommandBar", () => {
  it("submits trimmed text and clears", () => {
    const onSubmit = vi.fn();
    render(<CommandBar onSubmit={onSubmit} />);
    const input = screen.getByLabelText("command") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  open downloads  " } });
    fireEvent.click(screen.getByLabelText("send"));
    expect(onSubmit).toHaveBeenCalledWith("open downloads");
    expect(input.value).toBe("");
  });

  it("ignores empty submits", () => {
    const onSubmit = vi.fn();
    render(<CommandBar onSubmit={onSubmit} />);
    fireEvent.click(screen.getByLabelText("send"));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
