// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOrbitRotation } from "./useOrbitRotation.js";

describe("useOrbitRotation", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("rotates by 0.3 deg per tick (20ms ~ 50fps) when not paused", () => {
    const { result } = renderHook(() => useOrbitRotation({ paused: false }));
    expect(result.current.angle).toBe(0);
    act(() => { vi.advanceTimersByTime(20); });
    expect(result.current.angle).toBeCloseTo(0.3, 5);
  });

  it("does not rotate while paused", () => {
    const { result } = renderHook(() => useOrbitRotation({ paused: true }));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.angle).toBe(0);
  });

  it("wraps angle modulo 360", () => {
    const { result } = renderHook(() => useOrbitRotation({ paused: false }));
    act(() => { vi.advanceTimersByTime(20 * 1300); });
    expect(result.current.angle).toBeLessThan(360);
    expect(result.current.angle).toBeGreaterThanOrEqual(0);
  });
});
