// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLongPress } from "./useLongPress.js";

describe("useLongPress", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("fires onTrigger after threshold ms", () => {
    const onTrigger = vi.fn();
    const { result } = renderHook(() => useLongPress({ thresholdMs: 500, onTrigger }));
    act(() => { result.current.handlers.onPointerDown(); });
    act(() => { vi.advanceTimersByTime(499); });
    expect(onTrigger).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("cancels on pointerup before threshold", () => {
    const onTrigger = vi.fn();
    const { result } = renderHook(() => useLongPress({ thresholdMs: 500, onTrigger }));
    act(() => { result.current.handlers.onPointerDown(); });
    act(() => { vi.advanceTimersByTime(300); });
    act(() => { result.current.handlers.onPointerUp(); });
    act(() => { vi.advanceTimersByTime(500); });
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("progress goes 0..1 over the threshold", () => {
    const onTrigger = vi.fn();
    const { result } = renderHook(() => useLongPress({ thresholdMs: 500, onTrigger }));
    act(() => { result.current.handlers.onPointerDown(); });
    act(() => { vi.advanceTimersByTime(250); });
    expect(result.current.progress).toBeGreaterThan(0.4);
    expect(result.current.progress).toBeLessThan(0.6);
  });
});
