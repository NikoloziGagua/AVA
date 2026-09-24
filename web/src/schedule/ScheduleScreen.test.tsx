// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../components/ava/PanelShell.js", () => ({
  PanelShell: ({ title, children }: { title: string; children: React.ReactNode }) => <main><h1>{title}</h1>{children}</main>,
  PanelSection: ({ title, children }: { title: string; children: React.ReactNode }) => <section aria-label={title}>{children}</section>,
}));

import { ScheduleScreen } from "./ScheduleScreen.js";

afterEach(cleanup);

describe("Schedule before reminders exist", () => {
  it("says plainly that reminders are not active and offers only a way to Talk", () => {
    const onOpenTalk = vi.fn();
    render(<ScheduleScreen onOpenTalk={onOpenTalk} />);
    expect(screen.getByText("Reminders and deadlines are not active yet.")).toBeTruthy();
    expect(document.querySelectorAll("input, select, textarea, [role='switch'], [role='checkbox']")).toHaveLength(0);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]!);
    expect(onOpenTalk).toHaveBeenCalledOnce();
  });
});
