import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import {
  ApprovalSheet, Badge, Button, Card, Chip, EmptyState, ErrorState, Field, FloatingStack, NumberTicker, OfflineBanner,
  ProgressRing, Receipt, Row, Segmented, Sheet, Skeleton, SuggestionChips, Switch, Tag, TextInput, Tile, ToastProvider, useToast,
} from "./index.js";
import { cn } from "./cn.js";

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("cn", () => {
  it("keeps a token size and a token colour together", () => {
    expect(cn("text-body", "text-ink")).toBe("text-body text-ink");
  });
  it("still lets a later token of the same kind win", () => {
    expect(cn("text-body", "text-meta")).toBe("text-meta");
    expect(cn("shadow-e1", "shadow-e3")).toBe("shadow-e3");
    expect(cn("rounded-card", "rounded-sheet")).toBe("rounded-sheet");
  });
});

describe("Button", () => {
  it("is a real button that defaults to type=button", () => {
    render(<Button>Ask AVA</Button>);
    expect(screen.getByRole("button", { name: "Ask AVA" }).getAttribute("type")).toBe("button");
  });
  it("is busy and disabled while loading", () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Saving</Button>);
    const button = screen.getByRole("button", { name: "Saving" });
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
  it("only shimmers the solid variant", () => {
    const { container, rerender } = render(<Button variant="solid" shimmer>Go</Button>);
    expect(container.querySelector(".ds-shimmer")).not.toBeNull();
    rerender(<Button variant="glass" shimmer>Go</Button>);
    expect(container.querySelector(".ds-shimmer")).toBeNull();
  });
});

describe("Chip and SuggestionChips", () => {
  it("announces toggle state only when it is a toggle", () => {
    render(<><Chip selected>Attend</Chip><Chip>Plain</Chip></>);
    expect(screen.getByRole("button", { name: "Attend" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Plain" }).hasAttribute("aria-pressed")).toBe(false);
  });
  it("hands the picked suggestion back", () => {
    const onPick = vi.fn();
    render(<SuggestionChips suggestions={["Plan my day", "Continue Agile notes"]} onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue Agile notes" }));
    expect(onPick).toHaveBeenCalledWith("Continue Agile notes");
  });
  it("renders nothing without suggestions", () => {
    const { container } = render(<SuggestionChips suggestions={[]} onPick={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("Segmented", () => {
  function Harness() {
    const [value, setValue] = useState<"pages" | "board" | "list">("pages");
    return <Segmented label="View" value={value} onChange={setValue} options={[{ value: "pages", label: "Pages" }, { value: "board", label: "Board" }, { value: "list", label: "List" }]} />;
  }
  it("is a radio group with one checked, focusable option", () => {
    render(<Harness />);
    const group = screen.getByRole("radiogroup", { name: "View" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
  });
  it("moves with arrow keys, wraps, and jumps with Home and End", () => {
    render(<Harness />);
    const radio = (name: string) => screen.getByRole("radio", { name });
    fireEvent.keyDown(radio("Pages"), { key: "ArrowRight" });
    expect(radio("Board").getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(radio("Board"), { key: "End" });
    expect(radio("List").getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(radio("List"), { key: "ArrowRight" });
    expect(radio("Pages").getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(radio("Pages"), { key: "ArrowLeft" });
    expect(radio("List").getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(radio("List"), { key: "Home" });
    expect(radio("Pages").getAttribute("aria-checked")).toBe("true");
  });
});

describe("Field and Switch", () => {
  it("links the label, hint and error to the control", () => {
    render(
      <Field label="Folder name" hint="Shown in the tree." error="That name is already used here.">
        {({ id, describedBy, invalid }) => <TextInput id={id} aria-describedby={describedBy} aria-invalid={invalid} />}
      </Field>,
    );
    const input = screen.getByLabelText("Folder name");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const describedBy = input.getAttribute("aria-describedby")!;
    expect(document.getElementById(describedBy)?.textContent).toBe("That name is already used here.");
    expect(screen.getByRole("alert").textContent).toBe("That name is already used here.");
    expect(screen.queryByText("Shown in the tree.")).toBeNull();
  });
  it("switch toggles and reports its state", () => {
    const onChange = vi.fn();
    render(<Switch label="Lecture reminders" checked={false} onChange={onChange} />);
    const toggle = screen.getByRole("switch", { name: "Lecture reminders" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("Indicators", () => {
  it("tags carry their state in words", () => {
    render(<Tag tone="danger">Failed</Tag>);
    expect(screen.getByText("Failed")).not.toBeNull();
  });
  it("badges hide at zero and cap at 99+", () => {
    const { container, rerender } = render(<Badge count={0} label="unread" />);
    expect(container.innerHTML).toBe("");
    rerender(<Badge count={140} label="unread" />);
    expect(screen.getByLabelText("140 unread").textContent).toBe("99+");
  });
  it("progress ring exposes a clamped percentage", () => {
    render(<ProgressRing value={1.7} label="Study page filled" />);
    expect(screen.getByRole("progressbar", { name: "Study page filled" }).getAttribute("aria-valuenow")).toBe("100");
  });
  it("number ticker shows the final value at once with reduced motion", () => {
    localStorage.setItem("ava-motion", "reduced");
    render(<NumberTicker value={22} />);
    expect(screen.getByLabelText("22").textContent).toBe("22");
  });
});

describe("States", () => {
  it("empty state names what belongs there and offers the action", () => {
    render(<EmptyState title="No files here yet" body="Write one." action={<Button>New file</Button>} />);
    expect(screen.getByText("No files here yet")).not.toBeNull();
    expect(screen.getByRole("button", { name: "New file" })).not.toBeNull();
  });
  it("skeleton is announced as loading", () => {
    render(<Skeleton lines={3} />);
    expect(screen.getByRole("status", { name: "Loading" })).not.toBeNull();
  });
  it("error state is an alert with a working retry", () => {
    const onRetry = vi.fn();
    render(<ErrorState title="Notes couldn't load" onRetry={onRetry} />);
    expect(screen.getByRole("alert")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
  it("offline banner appears only while offline", () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    render(<OfflineBanner />);
    expect(screen.queryByRole("status")).toBeNull();
    online.mockReturnValue(false);
    act(() => { window.dispatchEvent(new Event("offline")); });
    expect(screen.getByRole("status").textContent).toContain("You're offline");
    online.mockReturnValue(true);
    act(() => { window.dispatchEvent(new Event("online")); });
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("Layout", () => {
  it("floating stack hides the cards behind the first until opened", () => {
    render(
      <FloatingStack label="reminders">
        <Card><button type="button">First</button></Card>
        <Card><button type="button">Second</button></Card>
      </FloatingStack>,
    );
    expect(screen.queryByRole("button", { name: "Second" })).toBeNull();
    const toggle = screen.getByRole("button", { name: "Show all 2 reminders" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Second" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe("true");
  });
  it("a single card needs no stack control", () => {
    render(<FloatingStack label="reminders"><Card>Only</Card></FloatingStack>);
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("tiles and clickable rows are buttons with their text as the name", () => {
    const onClick = vi.fn();
    render(<><Tile title="AVA" meta="12 files" /><Row title="Plan for the reflection" meta="Today" onClick={onClick} /></>);
    expect(screen.getByRole("button", { name: /AVA/ })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Plan for the reflection/ }));
    expect(onClick).toHaveBeenCalled();
  });
});

describe("Sheet and ApprovalSheet", () => {
  it("opens as a titled dialog and closes with Escape", () => {
    const onOpenChange = vi.fn();
    render(<Sheet open onOpenChange={onOpenChange} title="Move file" description="Choose a folder."><p>Body</p></Sheet>);
    const dialog = screen.getByRole("dialog", { name: "Move file" });
    expect(within(dialog).getByText("Choose a folder.")).not.toBeNull();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
  it("approval makes declining as easy as approving and says the risk", () => {
    const onApprove = vi.fn(), onDecline = vi.fn();
    render(<ApprovalSheet open onOpenChange={vi.fn()} title="Send this email?" summary="AVA wants to email your lecturer." risk="It can't be unsent." onApprove={onApprove} onDecline={onDecline} />);
    expect(screen.getByText("It can't be unsent.")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Don't do it" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onDecline).toHaveBeenCalledTimes(1);
    expect(onApprove).toHaveBeenCalledTimes(1);
  });
});

describe("Toast", () => {
  function Trigger({ tone }: { tone?: "neutral" | "success" | "danger" }) {
    const toast = useToast();
    return <button type="button" onClick={() => toast({ message: "Moved.", tone, action: { label: "Undo", onAction: () => toast({ message: "Moved back." }) } })}>Go</button>;
  }
  it("confirms, offers undo, and disappears on its own", () => {
    vi.useFakeTimers();
    render(<ToastProvider><Trigger /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    expect(screen.getByRole("status").textContent).toContain("Moved.");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByText("Moved back.")).not.toBeNull();
    act(() => { vi.advanceTimersByTime(5100); });
    expect(screen.queryByText("Moved back.")).toBeNull();
  });
  it("keeps errors until dismissed", () => {
    vi.useFakeTimers();
    render(<ToastProvider><Trigger tone="danger" /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    act(() => { vi.advanceTimersByTime(20000); });
    expect(screen.getByRole("alert").textContent).toContain("Moved.");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("refuses to be used outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Trigger />)).toThrow(/ToastProvider/);
  });
});

describe("Receipt", () => {
  it("states what happened and its state in words", () => {
    render(<Receipt title="Posted to the dev room" status="Accepted" detail="Not yet read by an agent." proof="#512" />);
    expect(screen.getByText("Posted to the dev room")).not.toBeNull();
    expect(screen.getByText("Accepted")).not.toBeNull();
    expect(screen.getByText("#512")).not.toBeNull();
  });
});
