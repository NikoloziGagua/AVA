import { describe, it, expect } from "vitest";
import { stripMarkdown } from "./strip-markdown.js";

describe("stripMarkdown", () => {
  it("strips bold asterisks (the verified live defect)", () => {
    expect(stripMarkdown("Average: **0ms**, Sir.")).toBe("Average: 0ms, Sir.");
  });

  it("strips bold underscores", () => {
    expect(stripMarkdown("that is __important__ now")).toBe("that is important now");
  });

  it("strips italic asterisks", () => {
    expect(stripMarkdown("a *subtle* hint")).toBe("a subtle hint");
    expect(stripMarkdown("*leading* word")).toBe("leading word");
  });

  it("strips italic underscores at word boundaries only", () => {
    expect(stripMarkdown("an _aside_ here")).toBe("an aside here");
    expect(stripMarkdown("file snake_case_name.ts stays")).toBe("file snake_case_name.ts stays");
  });

  it("strips inline code backticks", () => {
    expect(stripMarkdown("run `git status` now")).toBe("run git status now");
  });

  it("strips heading markers at line starts", () => {
    expect(stripMarkdown("## Results\nAll green.")).toBe("Results\nAll green.");
    expect(stripMarkdown("# One\n### Three")).toBe("One\nThree");
  });

  it("handles nested bold+italic", () => {
    expect(stripMarkdown("***very*** sure")).toBe("very sure");
  });

  it("leaves bare multiplication alone", () => {
    expect(stripMarkdown("2 * 3 * 4 = 24")).toBe("2 * 3 * 4 = 24");
  });

  it("leaves plain text and the inner content untouched", () => {
    expect(stripMarkdown("nothing to strip here.")).toBe("nothing to strip here.");
    expect(stripMarkdown("**`code` inside bold**")).toBe("code inside bold");
  });

  it("does not treat a mid-sentence # as a heading", () => {
    expect(stripMarkdown("issue #42 is fixed")).toBe("issue #42 is fixed");
  });
});
