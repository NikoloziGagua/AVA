// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ActivityPanel } from "./ActivityPanel.js";

afterEach(cleanup);

const steps = [
  { key: "1", label: "chrome_navigate", status: "done" as const, ok: true },
  { key: "2", label: "computer_use", status: "running" as const },
];

describe("ActivityPanel", () => {
  it("expanded lists steps and can collapse", () => {
    const onToggle = vi.fn();
    render(<ActivityPanel steps={steps} collapsed={false} onToggle={onToggle} executing />);
    expect(screen.getByText("chrome_navigate")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("collapse activity"));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("collapsed shows a tab that can expand", () => {
    const onToggle = vi.fn();
    render(<ActivityPanel steps={steps} collapsed onToggle={onToggle} executing />);
    fireEvent.click(screen.getByLabelText("show activity"));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
