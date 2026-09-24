export type DocumentPage = {
  id: string;
  anchor: string;
  title: string;
  markdown: string;
};

export type PageLayout = {
  charsPerLine: number;
  maxLines: number;
};

type MarkdownBlock = {
  sourceIndex: number;
  splitIndex: number;
  markdown: string;
  kind: "heading" | "prose" | "list" | "table" | "code" | "other";
  heading: string | null;
};

const HEADING = /^(#{1,6})\s+(.+?)\s*#*$/;
const FENCE = /^\s*(```|~~~)/;
const LIST = /^\s*(?:[-+*]|\d+[.)])\s+/;

/**
 * A responsive approximation of AVA's 15px/1.65 Markdown typography. The
 * reader width is measured in the browser; these buckets keep pagination
 * deterministic without persisting disposable visual boundaries.
 */
export function pageLayoutForWidth(width: number): PageLayout {
  if (width < 520) return { charsPerLine: 38, maxLines: 18 };
  if (width < 820) return { charsPerLine: 56, maxLines: 20 };
  return { charsPerLine: 76, maxLines: 22 };
}

function blockKind(lines: string[], fenced: boolean): MarkdownBlock["kind"] {
  if (fenced) return "code";
  if (lines.length === 1 && HEADING.test(lines[0] ?? "")) return "heading";
  if (lines.every((line) => !line.trim() || LIST.test(line))) return "list";
  if (lines.length >= 2 && lines.every((line) => line.includes("|"))) return "table";
  if (lines.length === 1 && /^\s*(?:---+|___+|\*\*\*+)\s*$/.test(lines[0] ?? "")) return "other";
  return "prose";
}

/** Split Markdown at safe top-level block boundaries while keeping fences. */
function markdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let current: string[] = [];
  let fence: string | null = null;

  const flush = () => {
    if (!current.length) return;
    const raw = current.join("\n").trim();
    current = [];
    if (!raw) return;
    const blockLines = raw.split("\n");
    const match = blockLines.length === 1 ? HEADING.exec(blockLines[0] ?? "") : null;
    blocks.push({
      sourceIndex: blocks.length,
      splitIndex: 0,
      markdown: raw,
      kind: blockKind(blockLines, FENCE.test(blockLines[0] ?? "")),
      heading: match?.[2]?.trim() ?? null,
    });
  };

  for (const line of lines) {
    const fenceMatch = FENCE.exec(line);
    if (fence) {
      current.push(line);
      if (fenceMatch?.[1] === fence) {
        fence = null;
        flush();
      }
      continue;
    }
    if (fenceMatch) {
      flush();
      fence = fenceMatch[1] ?? null;
      current.push(line);
      continue;
    }
    if (HEADING.test(line)) {
      flush();
      current.push(line);
      flush();
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();
  return blocks;
}

function visibleLength(markdown: string): number {
  return markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+/gm, "")
    .replace(/[`*_~>]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .length;
}

function estimatedLines(block: MarkdownBlock, charsPerLine: number): number {
  const physical = block.markdown.split("\n").length;
  if (block.kind === "heading") return 3;
  if (block.kind === "code" || block.kind === "table") return Math.max(3, physical + 2);
  if (block.kind === "list") {
    return block.markdown.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(visibleLength(line) / Math.max(18, charsPerLine - 5))), 0) + 1;
  }
  return Math.max(2, Math.ceil(visibleLength(block.markdown) / charsPerLine) + physical - 1);
}

function canSplitProse(block: MarkdownBlock): boolean {
  if (block.kind !== "prose") return false;
  // Avoid cutting paired Markdown tokens. Complex/oversized blocks remain
  // intact and can scroll; the continuous reader is always available.
  return !/(?:\[[^\]]*$|\]\([^)]*$|`|<[^>]*$)/.test(block.markdown);
}

function splitLongProse(block: MarkdownBlock, layout: PageLayout): MarkdownBlock[] {
  if (!canSplitProse(block) || estimatedLines(block, layout.charsPerLine) <= layout.maxLines) return [block];
  // Reserve enough room for a nearby heading and its visual spacing so a
  // section title is not stranded on a page by itself.
  const target = Math.max(layout.charsPerLine * Math.max(6, layout.maxLines - 6), 240);
  const words = block.markdown.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let chunk = "";
  for (const word of words) {
    const candidate = chunk ? `${chunk} ${word}` : word;
    if (chunk && candidate.length > target) {
      chunks.push(chunk);
      chunk = word;
    } else {
      chunk = candidate;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks.map((markdown, splitIndex) => ({ ...block, splitIndex, markdown }));
}

function pageTitle(blocks: MarkdownBlock[], index: number, inheritedHeading: string | null): string {
  return blocks.find((block) => block.heading)?.heading ?? inheritedHeading ?? `Page ${index + 1}`;
}

/**
 * Derive disposable reader pages from one canonical Markdown document.
 * Nothing returned here is suitable as persistent identity.
 */
export function paginateDocument(markdown: string, layout: PageLayout): DocumentPage[] {
  const source = markdownBlocks(markdown);
  if (!source.length) return [{ id: "page-1", anchor: "block-0", title: "Page 1", markdown: "" }];
  const blocks = source.flatMap((block) => splitLongProse(block, layout));
  const pages: Array<{ blocks: MarkdownBlock[]; inheritedHeading: string | null }> = [];
  let current: MarkdownBlock[] = [];
  let lines = 0;
  let activeHeading: string | null = null;

  const flush = () => {
    if (!current.length) return;
    pages.push({ blocks: current, inheritedHeading: activeHeading });
    const lastHeading = current.slice().reverse().find((block) => block.heading)?.heading;
    if (lastHeading) activeHeading = lastHeading;
    current = [];
    lines = 0;
  };

  for (let at = 0; at < blocks.length; at += 1) {
    const block = blocks[at]!;
    const blockLines = estimatedLines(block, layout.charsPerLine);
    const next = blocks[at + 1];
    const keepWithNext = block.kind === "heading" && next
      ? Math.min(estimatedLines(next, layout.charsPerLine), Math.max(4, Math.floor(layout.maxLines / 2)))
      : 0;
    // Headings are preferred boundaries once a page is meaningfully occupied.
    if (block.kind === "heading" && current.length && lines >= Math.floor(layout.maxLines * 0.55)) flush();
    if (current.length && lines + blockLines + keepWithNext > layout.maxLines) flush();
    current.push(block);
    lines += blockLines;
    if (lines >= layout.maxLines) flush();
  }
  flush();

  return pages.map((page, index) => {
    const first = page.blocks[0]!;
    const anchor = `block-${first.sourceIndex}-${first.splitIndex}`;
    return {
      id: `page-${index + 1}`,
      anchor,
      title: pageTitle(page.blocks, index, page.inheritedHeading),
      markdown: page.blocks.map((block) => block.markdown).join("\n\n"),
    };
  });
}
