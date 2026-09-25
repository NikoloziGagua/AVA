import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { BottomBar, StatusIsland, type Destination } from "./index.js";

afterEach(() => { cleanup(); });

const DESTINATIONS: Destination[] = [
  { id: "home", label: "Home", icon: null, group: "primary" },
  { id: "notes", label: "Notes", icon: null, group: "primary" },
  { id: "settings", label: "Settings", icon: null, group: "system" },
];
const RECENTS = Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, title: `Chat ${i}` }));

function Harness(props: { sending?: boolean; onSend?: (t: string) => void; onNavigate?: (id: string) => void; onTalk?: () => void }) {
  const [draft, setDraft] = useState("");
  return (
    <BottomBar
      destinations={DESTINATIONS}
      current="home"
      onNavigate={props.onNavigate ?? vi.fn()}
      recents={RECENTS}
      onOpenRecent={vi.fn()}
      onOpenAllConversations={vi.fn()}
      draft={draft}
      onDraftChange={setDraft}
      onSend={props.onSend ?? vi.fn()}
      onTalk={props.onTalk}
      sending={props.sending}
    />
  );
}

const menu = () => document.querySelector<HTMLElement>('[role="dialog"][aria-label="Menu"]')!;

describe("BottomBar", () => {
  it("starts closed, with the menu hidden from assistive tech", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: "Open menu" }).getAttribute("aria-expanded")).toBe("false");
    expect(menu().getAttribute("aria-hidden")).toBe("true");
  });

  it("opens, focuses the first item, marks the current screen and moves with arrows", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(menu().getAttribute("data-open")).toBe("true");
    const home = screen.getByRole("button", { name: "Home" });
    expect(document.activeElement).toBe(home);
    expect(home.getAttribute("aria-current")).toBe("page");
    fireEvent.keyDown(home, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Notes" }));
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Settings" }));
  });

  it("closes on Escape and returns focus to the orb", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Home" }), { key: "Escape" });
    expect(menu().getAttribute("data-open")).toBe("false");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open menu" }));
  });

  it("toggles with Ctrl+K and closes on a press outside", () => {
    render(<><Harness /><p>Outside</p></>);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(menu().getAttribute("data-open")).toBe("true");
    fireEvent.pointerDown(screen.getByText("Outside"));
    expect(menu().getAttribute("data-open")).toBe("false");
  });

  it("navigates and closes when a destination is chosen", () => {
    const onNavigate = vi.fn();
    render(<Harness onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    fireEvent.click(screen.getByRole("button", { name: "Notes" }));
    expect(onNavigate).toHaveBeenCalledWith("notes");
    expect(menu().getAttribute("data-open")).toBe("false");
  });

  it("shows at most five recent conversations", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(screen.getByRole("button", { name: /Chat 4/ })).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Chat 5/ })).toBeNull();
    expect(screen.getByRole("button", { name: "All conversations" })).not.toBeNull();
  });

  it("keeps the draft while the menu opens and closes", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Message AVA"), { target: { value: "Remind me about the reflection" } });
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Home" }), { key: "Escape" });
    expect((screen.getByLabelText("Message AVA") as HTMLInputElement).value).toBe("Remind me about the reflection");
  });

  it("sends the trimmed draft once, and never while a send is in flight", () => {
    const onSend = vi.fn();
    const { rerender } = render(<Harness onSend={onSend} onTalk={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Message AVA"), { target: { value: "  hello  " } });
    fireEvent.submit(screen.getByLabelText("Message AVA").closest("form")!);
    expect(onSend).toHaveBeenCalledWith("hello");
    rerender(<Harness onSend={onSend} onTalk={vi.fn()} sending />);
    fireEvent.change(screen.getByLabelText("Message AVA"), { target: { value: "again" } });
    fireEvent.submit(screen.getByLabelText("Message AVA").closest("form")!);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("offers talk when the draft is empty and send when it is not", () => {
    const onTalk = vi.fn();
    render(<Harness onTalk={onTalk} />);
    fireEvent.click(screen.getByRole("button", { name: "Talk to AVA" }));
    expect(onTalk).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Message AVA"), { target: { value: "hi" } });
    expect(screen.queryByRole("button", { name: "Talk to AVA" })).toBeNull();
    expect(screen.getByRole("button", { name: "Send" })).not.toBeNull();
  });
});

describe("StatusIsland", () => {
  it("lets the voice bars follow a measured level, and keeps the rhythm without one", async () => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 4) as unknown as number);
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
    let level: number | null = 0.8;
    const { container } = render(<StatusIsland mode="speaking" sampleLevel={() => level} />);
    const bars = container.querySelector<HTMLElement>(".ds-island-bars")!;
    await waitFor(() => expect(bars.dataset.live).toBe("true"));
    expect(bars.querySelector("i")!.style.transform).toMatch(/^scaleY\(/);
    level = null;
    await waitFor(() => expect(bars.dataset.live).toBe("false"));
    expect(bars.querySelector("i")!.style.transform).toBe("");
    vi.unstubAllGlobals();
  });

  it("announces what AVA is doing in words", () => {
    render(<StatusIsland mode="thinking" />);
    expect(screen.getByRole("status").textContent).toContain("Thinking");
  });
  it("shows voice bars only while speaking, and extra detail when given", () => {
    const { container, rerender } = render(<StatusIsland mode="speaking" />);
    expect(container.querySelector(".ds-island-bars")).not.toBeNull();
    rerender(<StatusIsland mode="working" detail="Filing your Agile notes" />);
    expect(container.querySelector(".ds-island-bars")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Filing your Agile notes");
  });
});
