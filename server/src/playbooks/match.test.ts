import { describe, it, expect } from "vitest";
import { matchPlaybook, tokenize } from "./match.js";

const index = [
  { slug: "download-electricity-bill", trigger: "download the electricity bill", keywords: ["electricity", "bill", "pdf"], uses: 3 },
  { slug: "post-tweet", trigger: "post a tweet", keywords: ["twitter", "tweet"], uses: 1 },
];

describe("matchPlaybook (local, instant)", () => {
  it("matches a request that shares the trigger's meaningful tokens", () => {
    expect(matchPlaybook({ prompt: "download my electricity bill please", index }))
      .toBe("download-electricity-bill");
  });
  it("matches regardless of word order and casing", () => {
    expect(matchPlaybook({ prompt: "Electricity bill — download it", index }))
      .toBe("download-electricity-bill");
  });
  it("returns null for an unrelated request", () => {
    expect(matchPlaybook({ prompt: "what's the weather like today", index })).toBeNull();
  });
  it("does NOT loosely match on a single shared token (precision first)", () => {
    // "pay my phone bill" shares only "bill" — injecting the electricity
    // playbook here would steer the run wrong. No match is the right answer.
    expect(matchPlaybook({ prompt: "pay my phone bill", index })).toBeNull();
  });
  it("accepted trade: pure paraphrases without lexical overlap do not recall", () => {
    // The old side-model matcher could map "power bill" → electricity-bill but
    // cost 1.7-2.8s of pre-roll on EVERY typed turn (measured live). Local
    // matching gives that up; the agent simply runs without the hint.
    expect(matchPlaybook({ prompt: "grab my power statement", index })).toBeNull();
  });
  it("returns null with an empty index", () => {
    expect(matchPlaybook({ prompt: "download the electricity bill", index: [] })).toBeNull();
  });
  it("breaks score ties toward the more-used playbook", () => {
    const tied = [
      { slug: "open-spotify-a", trigger: "open spotify playlist", uses: 1 },
      { slug: "open-spotify-b", trigger: "open spotify playlist", uses: 9 },
    ];
    expect(matchPlaybook({ prompt: "open my spotify playlist", index: tied })).toBe("open-spotify-b");
  });
});

describe("tokenize", () => {
  it("drops stopwords and short tokens, dedupes", () => {
    expect(tokenize("Download the THE bill bill to PC")).toEqual(["download", "bill"]);
  });
});
