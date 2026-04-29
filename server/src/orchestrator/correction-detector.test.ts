import { describe, it, expect } from "vitest";
import { detectCorrection } from "./correction-detector.js";

const FIVE_MIN = 5 * 60 * 1000;

describe("detectCorrection", () => {
  it("matches common correction openers", () => {
    const cases = [
      "no, don't auto-run things",
      "Nope — try again",
      "wrong, that wasn't what I meant",
      "actually, use bash",
      "Stop. Don't open chrome",
      "don't do that",
      "Do not retry silently",
      "instead: run the tests",
    ];
    for (const userText of cases) {
      const r = detectCorrection({
        userText,
        priorRole: "assistant",
        priorAtMs: 1000,
        nowMs: 1000 + 1000,
      });
      expect(r).toBe(true);
    }
  });

  it("does not match unrelated text", () => {
    const r = detectCorrection({
      userText: "open chrome to example.com",
      priorRole: "assistant",
      priorAtMs: 0, nowMs: 1000,
    });
    expect(r).toBe(false);
  });

  it("does not trigger when prior turn was the user", () => {
    const r = detectCorrection({
      userText: "no, don't",
      priorRole: "user",
      priorAtMs: 0, nowMs: 1000,
    });
    expect(r).toBe(false);
  });

  it("does not trigger when prior assistant turn is older than 5 minutes", () => {
    const r = detectCorrection({
      userText: "no, don't",
      priorRole: "assistant",
      priorAtMs: 0, nowMs: FIVE_MIN + 1,
    });
    expect(r).toBe(false);
  });

  it("triggers exactly at 5 minutes (boundary inclusive)", () => {
    const r = detectCorrection({
      userText: "no, don't",
      priorRole: "assistant",
      priorAtMs: 0, nowMs: FIVE_MIN,
    });
    expect(r).toBe(true);
  });

  it("does not trigger when there is no prior turn", () => {
    const r = detectCorrection({
      userText: "no, don't",
      priorRole: null, priorAtMs: null, nowMs: 1000,
    });
    expect(r).toBe(false);
  });
});
