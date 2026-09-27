// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WhenField } from "./WhenField.js";
import { ReminderStatusChip } from "./ReminderStatusChip.js";
import type { ReminderTone } from "./presenter.js";

afterEach(cleanup);
const NOW = Date.UTC(2026, 0, 1);
const props = { label: "When", value: "2026-10-25T01:30", onChange: vi.fn(), occurrence: null, onOccurrenceChange: vi.fn(), zone: "Europe/Dublin", now: NOW };

describe("Reminder presentation boundaries", () => {
  it.each(["pending", "active", "good", "warn", "bad", "muted"] as ReminderTone[])("keeps %s receipt words identical across explicit Atelier and default legacy", tone => {
    const presentation = { label: "Accepted by notification service", detail: "Receipt unconfirmed", due: "Tomorrow", tone };
    const { container } = render(<><ReminderStatusChip presentation={presentation} /><ReminderStatusChip presentation={presentation} appearance="atelier" /></>);
    const receipts = screen.getAllByText(presentation.label);
    expect(receipts).toHaveLength(2);
    expect(receipts.map(el => el.dataset.reminderTone)).toEqual([tone, tone]);
    expect(container.querySelector('[data-reminder-appearance="legacy"]')?.classList.contains("chip")).toBe(true);
    expect(container.querySelector('[data-reminder-appearance="atelier"]')?.classList.contains("ds-reminder-status")).toBe(true);
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  it.each(["atelier", "legacy"] as const)("keeps the %s repeated-hour choice explicit and labelled", appearance => {
    const onOccurrenceChange = vi.fn();
    render(<WhenField {...props} appearance={appearance} onOccurrenceChange={onOccurrenceChange} showErrors />);
    const field = screen.getByLabelText("When");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(field.getAttribute("aria-describedby")!.split(" ")[1]!)?.textContent).toContain("happens twice");
    const second = screen.getByRole("radio", { name: /The second one/ });
    expect((second as HTMLInputElement).checked).toBe(false);
    fireEvent.click(second);
    expect(onOccurrenceChange).toHaveBeenCalledTimes(1);
    expect(onOccurrenceChange).toHaveBeenCalledWith(1);
  });

  it("announces skipped time and leaves the underlying value unchanged", () => {
    render(<WhenField {...props} appearance="atelier" value="2026-03-29T01:30" />);
    expect(screen.getByRole("alert").textContent).toContain("doesn't exist");
    expect((screen.getByLabelText("When") as HTMLInputElement).value).toBe("2026-03-29T01:30");
  });

  it("resets the occurrence only on an explicit date edit, and respects disabled", () => {
    const onChange = vi.fn(), onOccurrenceChange = vi.fn();
    const { rerender } = render(<WhenField {...props} appearance="atelier" onChange={onChange} onOccurrenceChange={onOccurrenceChange} />);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("When"), { target: { value: "2026-10-26T09:00" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("2026-10-26T09:00");
    expect(onOccurrenceChange).toHaveBeenCalledTimes(1);
    expect(onOccurrenceChange).toHaveBeenCalledWith(null);
    rerender(<WhenField {...props} appearance="atelier" disabled />);
    expect((screen.getByLabelText("When") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getAllByRole("radio").every(el => (el as HTMLInputElement).disabled)).toBe(true);
  });
});
