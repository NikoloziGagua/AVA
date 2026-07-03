import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createStuckLoop, STUCK_WALLCLOCK_MS } from "./stuck-loop.js";

describe("createStuckLoop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns no halt when no observations have been made", () => {
    const guard = createStuckLoop({ now: () => Date.now() });
    // Without any observations there is nothing to decide; observeThought alone
    // does not produce a decision, so we just assert no throw and that the
    // first observation under-budget is no-halt.
    const dec = guard.observe({ tool: "fs_read", resultText: "x", at: Date.now() });
    expect(dec).toEqual({ halt: false });
  });

  it("under wallclock with a new thought emitted does not halt", () => {
    const guard = createStuckLoop({ now: () => Date.now() });
    const t0 = Date.now();
    // Five identical screenshots but with a thought in the middle.
    for (let i = 0; i < 5; i++) {
      if (i === 2) guard.observeThought("trying a different approach");
      const dec = guard.observe({ tool: "chrome_screenshot", resultText: "same-frame", at: t0 + i * 1000 });
      expect(dec).toEqual({ halt: false });
    }
  });

  it("halts with reason wallclock when results stop changing for the whole budget", () => {
    const start = Date.now();
    const guard = createStuckLoop({ now: () => start });
    // First result is novel (resets the progress clock at t0)…
    expect(guard.observe({ tool: "fs_read", resultText: "same output", at: start }))
      .toEqual({ halt: false });
    // …then the IDENTICAL result a full budget later = no progress → halt.
    const dec = guard.observe({
      tool: "fs_read",
      resultText: "same output",
      at: start + STUCK_WALLCLOCK_MS,
    });
    expect(dec).toEqual({ halt: true, reason: "wallclock" });
  });

  it("does NOT halt a long run that keeps making progress (novel results past the budget)", () => {
    const start = Date.now();
    const guard = createStuckLoop({ now: () => start });
    // A real multi-phase task: every result is different, total runtime far past
    // the old 5-minute start-anchored kill. Progress must keep it alive.
    for (let i = 0; i < 4; i++) {
      const dec = guard.observe({
        tool: "shell",
        resultText: `step ${i}: ${"x".repeat(80 + i * 80)}`,
        at: start + i * STUCK_WALLCLOCK_MS,
      });
      expect(dec).toEqual({ halt: false });
    }
  });

  it("a thought resets the no-progress wallclock", () => {
    let clock = 1_000_000;
    const guard = createStuckLoop({ now: () => clock });
    expect(guard.observe({ tool: "fs_read", resultText: "same", at: clock })).toEqual({ halt: false });
    // Thought lands just before the budget would expire…
    clock = 1_000_000 + STUCK_WALLCLOCK_MS - 1_000;
    guard.observeThought("still working through the list");
    // …so an identical result AT the old deadline is fine now.
    const dec = guard.observe({ tool: "fs_read", resultText: "same", at: 1_000_000 + STUCK_WALLCLOCK_MS });
    expect(dec).toEqual({ halt: false });
  });

  it("halts with reason no-progress when 5 identical screenshots arrive without a thought", () => {
    const start = Date.now();
    const guard = createStuckLoop({ now: () => start });
    let lastDec: ReturnType<typeof guard.observe> | undefined;
    for (let i = 0; i < 5; i++) {
      lastDec = guard.observe({
        tool: "chrome_screenshot",
        resultText: "frame-bytes-identical",
        at: start + i * 12_000, // sameness must PERSIST past the 45s floor to count as stuck
      });
    }
    expect(lastDec).toEqual({ halt: true, reason: "no-progress" });
  });

  it("does not halt when 5 screenshots are very different (distance > threshold) and no thought", () => {
    const start = Date.now();
    const guard = createStuckLoop({ now: () => start });
    // Each screenshot is 200+ chars and totally different from the previous,
    // forcing Levenshtein distance well above the 50-char threshold.
    const frames = [
      "a".repeat(200),
      "b".repeat(200),
      "c".repeat(200),
      "d".repeat(200),
      "e".repeat(200),
    ];
    let lastDec: ReturnType<typeof guard.observe> | undefined;
    for (let i = 0; i < 5; i++) {
      lastDec = guard.observe({
        tool: "chrome_screenshot",
        resultText: frames[i]!,
        at: start + i * 12_000, // sameness must PERSIST past the 45s floor to count as stuck
      });
    }
    expect(lastDec).toEqual({ halt: false });
  });

  it("does not halt when 5 identical screenshots arrive but a thought lands mid-window", () => {
    let clock = 1_000_000;
    const guard = createStuckLoop({ now: () => clock });
    let lastDec: ReturnType<typeof guard.observe> | undefined;
    for (let i = 0; i < 5; i++) {
      clock = 1_000_000 + i * 1000;
      if (i === 2) guard.observeThought("re-planning before next screenshot");
      lastDec = guard.observe({
        tool: "chrome_screenshot",
        resultText: "identical-frame",
        at: clock,
      });
    }
    expect(lastDec).toEqual({ halt: false });
  });
});

describe("2026-07-03 regressions: healthy fast flows must not halt", () => {
  it("a 15s healthy SPA flow with two similar page-reads does NOT halt", () => {
    const start = Date.now();
    const guard = createStuckLoop({ now: () => start });
    const obs = (tool: string, resultText: string, sec: number) =>
      guard.observe({ tool, resultText, at: start + sec * 1000 });
    obs("chrome_navigate", "loaded: Instagram • Messages", 2);
    obs("chrome_read_page", "inbox list with lots of chats and stories", 4);
    obs("chrome_click", "clicked", 6);
    obs("chrome_read_page", "inbox list with lots of chats and stories", 8);
    const last = obs("chrome_type", "typed", 10);
    expect(last).toEqual({ halt: false });
  });

  it("succeeding action tools reset the no-progress wallclock even with identical result text", () => {
    const start = Date.now();
    const guard = createStuckLoop({ now: () => start, wallclockMs: 60_000 });
    // clicks every 30s with identical "clicked" text — actions ARE progress,
    // so the 60s wallclock never expires.
    let dec = guard.observe({ tool: "chrome_click", resultText: "clicked", at: start + 30_000 });
    dec = guard.observe({ tool: "chrome_click", resultText: "clicked", at: start + 60_000 });
    dec = guard.observe({ tool: "chrome_click", resultText: "clicked", at: start + 90_000 });
    expect(dec).toEqual({ halt: false });
  });

  it("persistent visual sameness past the floor still halts", () => {
    const start = Date.now();
    const guard = createStuckLoop({ now: () => start });
    let dec: ReturnType<typeof guard.observe> | undefined;
    for (let i = 0; i < 5; i++) {
      dec = guard.observe({ tool: "chrome_read_page", resultText: "same wall same wall", at: start + i * 15_000 });
    }
    expect(dec).toEqual({ halt: true, reason: "no-progress" });
  });
});
