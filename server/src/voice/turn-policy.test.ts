import { describe, expect, it } from "vitest";
import {
  looksLikeIncompleteVoiceTurn,
  VoiceTurnAccumulator,
} from "./turn-policy.js";

describe("looksLikeIncompleteVoiceTurn", () => {
  it.each([
    "You are",
    "What",
    "location",
    "Slowly",
    "The first step",
    "Positionspunkt",
    "I want you to go",
    "Can you open",
    "Tell Ava to",
  ])("holds the real incomplete/noise regression %j", (text) => {
    expect(looksLikeIncompleteVoiceTurn(text)).toBe(true);
  });

  it.each([
    "Open Chrome",
    "Go into WhatsApp",
    "Run the tests",
    "What time is it?",
    "She smiled.",
    "It worked",
    "Stop",
    "Continue",
    "Resume",
    "Sorry, mate",
  ])("allows the complete turn %j", (text) => {
    expect(looksLikeIncompleteVoiceTurn(text)).toBe(false);
  });
});

describe("VoiceTurnAccumulator", () => {
  it("joins a split destination before emitting one complete turn", () => {
    const turns = new VoiceTurnAccumulator();
    expect(turns.offer("I want you to go", "a")).toMatchObject({ kind: "hold" });
    expect(turns.offer("into WhatsApp", "b")).toEqual({
      kind: "emit",
      text: "I want you to go into WhatsApp",
      itemIds: ["a", "b"],
      discardedItemIds: [],
    });
  });

  it("replaces a stale fragment with a fresh complete command", () => {
    const turns = new VoiceTurnAccumulator();
    turns.offer("You are", "old");
    expect(turns.offer("Open Chrome", "new")).toEqual({
      kind: "emit",
      text: "Open Chrome",
      itemIds: ["new"],
      discardedItemIds: ["old"],
    });
  });

  it("expires held text without emitting it as a command", () => {
    const turns = new VoiceTurnAccumulator();
    turns.offer("The first step", "x");
    expect(turns.expire()).toEqual({ text: "The first step", itemIds: ["x"] });
    expect(turns.expire()).toBeNull();
  });
});
