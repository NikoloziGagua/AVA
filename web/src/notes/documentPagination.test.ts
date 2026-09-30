import { describe, expect, it } from "vitest";
import { pageLayoutForWidth, paginateDocument } from "./documentPagination.js";

describe("document pagination", () => {
  it("keeps a short file on one derived page", () => {
    const pages = paginateDocument("## Summary\n\nA short explanation.", pageLayoutForWidth(900));
    expect(pages).toHaveLength(1);
    expect(pages[0]?.title).toBe("Summary");
  });

  it("flows one long file across pages without creating note identity", () => {
    const content = `## Key concepts\n\n${"A useful concept explained clearly. ".repeat(90)}`;
    const pages = paginateDocument(content, { charsPerLine: 38, maxLines: 12 });
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((page) => page.id.startsWith("page-") && page.anchor.startsWith("block-"))).toBe(true);
    expect(pages.map((page) => page.markdown).join(" ")).toContain("useful concept");
  });

  it("prefers heading boundaries and carries the section title to continuations", () => {
    const content = `## First section\n\n${"First details. ".repeat(55)}\n\n## Second section\n\n${"Second details. ".repeat(20)}`;
    const pages = paginateDocument(content, { charsPerLine: 32, maxLines: 10 });
    expect(pages[0]?.title).toBe("First section");
    expect(pages.some((page) => page.title === "Second section")).toBe(true);
  });

  it("keeps fenced code intact and provides it on a readable page", () => {
    const code = `\`\`\`ts\n${Array.from({ length: 30 }, (_, i) => `const value${i} = ${i};`).join("\n")}\n\`\`\``;
    const pages = paginateDocument(`## Example\n\n${code}\n\nAfter the example.`, { charsPerLine: 30, maxLines: 8 });
    expect(pages.filter((page) => page.markdown.includes("```ts"))).toHaveLength(1);
    expect(pages.map((page) => page.markdown).join("\n\n")).toContain("const value29 = 29;");
  });

  it("uses smaller responsive budgets on narrow readers", () => {
    const text = `## Topic\n\n${"Responsive text. ".repeat(100)}`;
    expect(paginateDocument(text, pageLayoutForWidth(390)).length)
      .toBeGreaterThan(paginateDocument(text, pageLayoutForWidth(1000)).length);
  });
});
