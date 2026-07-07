// @vitest-environment jsdom
// The reconnect loop must be TERMINAL on an auth-rejected stream (401/403/404):
// EventSource marks such a connection CLOSED and won't auto-reconnect, so the
// manual 1s retry would otherwise hammer a rejected endpoint forever. A transient
// error (readyState CONNECTING) still reconnects.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useChatStream } from "./useChatStream.js";

class FakeES {
  static instances: FakeES[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  url: string;
  readyState = 1;
  closed = false;
  listeners = new Map<string, Array<(e: unknown) => void>>();
  constructor(url: string) {
    this.url = url;
    FakeES.instances.push(this);
  }
  addEventListener(kind: string, fn: (e: unknown) => void) {
    const arr = this.listeners.get(kind) ?? [];
    arr.push(fn);
    this.listeners.set(kind, arr);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  fire(kind: string) {
    for (const fn of this.listeners.get(kind) ?? []) fn({} as unknown);
  }
}

beforeEach(() => {
  FakeES.instances = [];
  vi.stubGlobal("EventSource", FakeES);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useChatStream reconnect", () => {
  it("stops reconnecting when the server rejects the stream (readyState CLOSED)", () => {
    renderHook(() => useChatStream("s1", 0));
    const es = FakeES.instances.at(-1)!;
    es.readyState = FakeES.CLOSED; // e.g. a 401 — connection failed permanently
    es.fire("error");
    vi.advanceTimersByTime(5000);
    // No second EventSource — the loop is terminal.
    expect(FakeES.instances.length).toBe(1);
  });

  it("reconnects on a transient error (readyState CONNECTING)", () => {
    renderHook(() => useChatStream("s1", 0));
    const es = FakeES.instances.at(-1)!;
    es.readyState = FakeES.CONNECTING; // a network blip — safe to retry
    es.fire("error");
    vi.advanceTimersByTime(1000);
    expect(FakeES.instances.length).toBe(2);
  });

  it("stops reconnecting when ava:unauthorized fires", () => {
    renderHook(() => useChatStream("s1", 0));
    window.dispatchEvent(new Event("ava:unauthorized"));
    const es = FakeES.instances.at(-1)!;
    es.readyState = FakeES.CONNECTING;
    es.fire("error");
    vi.advanceTimersByTime(2000);
    expect(FakeES.instances.length).toBe(1);
  });
});
