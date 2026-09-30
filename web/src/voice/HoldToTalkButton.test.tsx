// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HoldToTalkButton } from "./HoldToTalkButton.js";

afterEach(() => cleanup());

function setup() {
  const onStart = vi.fn();
  const onFinish = vi.fn();
  render(<HoldToTalkButton capturing={false} onStart={onStart} onFinish={onFinish} />);
  const button = screen.getByRole("button", { name: "hold to talk" });
  return { button, onStart, onFinish };
}

describe("HoldToTalkButton", () => {
  it("starts once per press and finishes once on release", () => {
    const { button, onStart, onFinish } = setup();
    fireEvent.pointerDown(button, { pointerId: 1 });
    // A repeated down while held (second finger, re-dispatch) is not a new turn.
    fireEvent.pointerDown(button, { pointerId: 2 });
    fireEvent.pointerUp(button, { pointerId: 1 });
    fireEvent.pointerUp(button, { pointerId: 2 });
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("cancels Safari's long-press gesture and synthesized click on touch", () => {
    const { button } = setup();
    const start = new Event("touchstart", { bubbles: true, cancelable: true });
    button.dispatchEvent(start);
    expect(start.defaultPrevented).toBe(true);
    const end = new Event("touchend", { bubbles: true, cancelable: true });
    button.dispatchEvent(end);
    expect(end.defaultPrevented).toBe(true);
    const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    button.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
  });

  it("finishes when the system cancels the pointer", () => {
    const { button, onFinish } = setup();
    fireEvent.pointerDown(button, { pointerId: 1 });
    fireEvent.pointerCancel(button, { pointerId: 1 });
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("uses pointerleave only as a fallback when capture is unavailable", () => {
    const { button, onFinish } = setup();
    // jsdom has no pointer capture, so this exercises the fallback path.
    fireEvent.pointerDown(button, { pointerId: 1 });
    fireEvent.pointerLeave(button, { pointerId: 1 });
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("ignores pointerleave while the press holds pointer capture", () => {
    const captured = setup();
    captured.button.setPointerCapture = vi.fn();
    fireEvent.pointerDown(captured.button, { pointerId: 3 });
    fireEvent.pointerLeave(captured.button, { pointerId: 3 });
    expect(captured.onFinish).not.toHaveBeenCalled();
    fireEvent.pointerUp(captured.button, { pointerId: 3 });
    expect(captured.onFinish).toHaveBeenCalledTimes(1);
  });

  it("blocks text selection and the iOS callout on the button", () => {
    const { button } = setup();
    expect(button.style.touchAction).toBe("none");
    expect(button.style.userSelect).toBe("none");
  });
});
