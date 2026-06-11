import { describe, it, expect } from "vitest";
import { splitForSpeech, splitSentences } from "./speech-chunks.js";

describe("splitSentences", () => {
  it("splits on sentence punctuation followed by whitespace", () => {
    expect(splitSentences("One done. Two next! Three?")).toEqual([
      "One done.",
      "Two next!",
      "Three?",
    ]);
  });

  it("does not split a decimal number", () => {
    expect(splitSentences("Average was 0.5 ms. All good.")).toEqual([
      "Average was 0.5 ms.",
      "All good.",
    ]);
  });

  it("does not split after a known abbreviation", () => {
    expect(splitSentences("Ask Dr. Smith about it. Then report back.")).toEqual([
      "Ask Dr. Smith about it.",
      "Then report back.",
    ]);
    expect(splitSentences("Use tools e.g. the shell. Then verify.")).toEqual([
      "Use tools e.g. the shell.",
      "Then verify.",
    ]);
  });

  it("keeps closing quotes with the sentence", () => {
    expect(splitSentences('She said "done." Then left.')).toEqual([
      'She said "done."',
      "Then left.",
    ]);
  });

  it("handles a text with no terminal punctuation", () => {
    expect(splitSentences("no punctuation at all")).toEqual(["no punctuation at all"]);
  });
});

describe("splitForSpeech", () => {
  it("keeps short texts whole (one clip, no extra TTS round-trips)", () => {
    expect(splitForSpeech("On it, Sir.")).toEqual(["On it, Sir."]);
    expect(splitForSpeech("First short. Second short.")).toEqual(["First short. Second short."]);
  });

  it("returns [] for empty/whitespace input", () => {
    expect(splitForSpeech("")).toEqual([]);
    expect(splitForSpeech("   ")).toEqual([]);
  });

  it("splits a long text so the FIRST sentence rides alone", () => {
    const first = "The deploy finished cleanly, Sir.";
    const rest =
      "All twelve services restarted within the expected window and the health checks went green. " +
      "Latency is back to baseline and no error spikes appeared in the last fifteen minutes.";
    const chunks = splitForSpeech(`${first} ${rest}`);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]).toBe(first);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(200);
    // Nothing lost: rejoining gives back the normalized text.
    expect(chunks.join(" ")).toBe(`${first} ${rest}`);
  });

  it("packs later sentences into ~≤200-char chunks instead of one clip per sentence", () => {
    const sentence = "This sentence is around sixty characters long, give or take.";
    const text = Array.from({ length: 6 }, () => sentence).join(" ");
    const chunks = splitForSpeech(text);
    expect(chunks[0]).toBe(sentence); // first alone
    expect(chunks.length).toBeLessThan(6); // the rest packed
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(200);
  });

  it("hard-splits a single overlong sentence at clause/word boundaries", () => {
    const long =
      "this single sentence keeps going with commas, more clauses, additional detail, " +
      "even more detail, and still more words so that it comfortably exceeds the two " +
      "hundred character chunk budget that the speak queue enforces for synthesis latency";
    const chunks = splitForSpeech(long);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(200);
      expect(c.length).toBeGreaterThan(0);
    }
  });

  it("collapses internal whitespace/newlines before chunking", () => {
    expect(splitForSpeech("Done,\n  Sir.")).toEqual(["Done, Sir."]);
  });
});
