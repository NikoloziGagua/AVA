import { describe, it, expect } from "vitest";
import { formatSpeechText } from "./speechText.js";

describe("formatSpeechText", () => {
  it("removes commas before and after a standalone Sir", () => {
    expect(formatSpeechText("Yes, Sir, I can do that.")).toBe("Yes Sir I can do that.");
  });

  it("removes a comma before Sir at end of sentence, preserving terminal punctuation", () => {
    expect(formatSpeechText("Shall I proceed, Sir?")).toBe("Shall I proceed Sir?");
  });

  it("removes a comma after a leading Sir", () => {
    expect(formatSpeechText("Sir, your coffee is ready.")).toBe("Sir your coffee is ready.");
  });

  it("does not insert a pause around Sir in an em-dash error report", () => {
    expect(formatSpeechText("That didn't work, Sir — disk full.")).toBe(
      "That didn't work Sir — disk full.",
    );
  });

  it("preserves the word Sir and its casing", () => {
    expect(formatSpeechText("Understood, Sir.")).toBe("Understood Sir.");
  });

  it("collapses whitespace introduced by comma removal", () => {
    expect(formatSpeechText("Done,    Sir.")).toBe("Done Sir.");
  });

  it("leaves text without Sir unchanged", () => {
    expect(formatSpeechText("Opening the file now.")).toBe("Opening the file now.");
  });

  it("does not touch words that merely start with Sir, such as Sirius", () => {
    expect(formatSpeechText("Tracking the star Sirius, Sir.")).toBe(
      "Tracking the star Sirius Sir.",
    );
  });

  it("handles multiple Sir occurrences", () => {
    expect(formatSpeechText("Yes, Sir. Right away, Sir.")).toBe("Yes Sir. Right away Sir.");
  });

  it("trims surrounding whitespace", () => {
    expect(formatSpeechText("  Yes, Sir.  ")).toBe("Yes Sir.");
  });
});
