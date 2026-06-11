// Strip markdown MARKERS for display. The model answers in light markdown
// ("Average: **0ms**, Sir.") but chat bubbles render plain text, so the raw
// asterisks/backticks showed verbatim. This is deliberately NOT a markdown
// renderer — it removes bold/italic/inline-code/heading markers and preserves
// the inner text untouched. Pure + tested.

export function stripMarkdown(text: string): string {
  return (
    text
      // Heading markers at line start: "## Results" → "Results".
      .replace(/^#{1,6}\s+/gm, "")
      // Bold: **text** / __text__.
      .replace(/\*\*([^*\n]+)\*\*/g, "$1")
      .replace(/__([^_\n]+)__/g, "$1")
      // Italic *text*: the inner run must not start/end with whitespace, so a
      // bare multiplication ("2 * 3 * 4") is left alone.
      .replace(/(^|[^*\w])\*(\S(?:[^*\n]*\S)?)\*(?=[^*\w]|$)/g, "$1$2")
      // Italic _text_: only at word boundaries, so snake_case survives.
      .replace(/(^|[^\w])_(\S(?:[^_\n]*\S)?)_(?=[^\w]|$)/g, "$1$2")
      // Inline code: `cmd` → cmd.
      .replace(/`([^`\n]+)`/g, "$1")
  );
}
