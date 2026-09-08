# Rich assistant Markdown

AVA renders assistant replies as structured Markdown directly inside the
conversation. The canonical message remains the original persisted Markdown
string; formatting is a browser presentation concern, so reopening a chat and
rendering a live final use the same component.

## Supported presentation

- Headings are demoted one level so an assistant reply cannot compete with the
  page's primary heading.
- Paragraphs, emphasis, strong text, strikethrough, block quotes, separators,
  ordered and unordered lists, and disabled task-list checkboxes.
- Inline and fenced code with horizontally scrollable, keyboard-focusable code
  blocks.
- GitHub-Flavoured Markdown tables in a labelled, keyboard-focusable horizontal
  scroll region that stays contained on narrow screens.
- Absolute HTTP(S) links, opened in a new tab with `noopener`, `noreferrer`, and
  `nofollow`. Unsafe or unsupported destinations render as plain text.

The existing message action still copies or shares the original Markdown
source. VisualMessage cards, task receipts, approvals, tool activity, retry,
and conversation history remain separate sibling content.

## Security and privacy

The implementation uses the bundled `react-markdown` syntax-tree renderer and
`remark-gfm`; it never uses `dangerouslySetInnerHTML`. Raw HTML is skipped.
Images and unapproved element types are not rendered. The URL boundary accepts
only absolute `http:` and `https:` destinations, rejecting `javascript:`,
`data:`, `file:`, custom protocols, and relative application paths. Generated
HTML or JavaScript is never evaluated.

Both dependencies are installed and bundled with AVA. No CDN or network request
is needed to parse or render a saved reply after installation.

## Streaming and motion

AVA keeps its existing stable response behavior: it accumulates provider deltas
while the thinking state is visible and renders the final Markdown tree once the
final event arrives. If Stop interrupts generation, the accumulated partial
source is rendered through the same safe component and labelled as partial.
Markdown adds no animation of its own; AVA's existing reduced-motion preference
continues to govern bubble and surrounding UI motion.

## Verification boundary

Formatting does not change a task's verification state. A bold word, heading,
link, or table remains presentation—not evidence of operational success.

Focused tests cover persisted and live replies, stopped partial output,
headings, lists, task lists, emphasis, code, tables, safe/unsafe links, raw HTML,
remote images, user-message literal text, source-preserving Copy, and the
existing visual/receipt/retry chat integrations.
