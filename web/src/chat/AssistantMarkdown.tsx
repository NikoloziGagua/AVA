import type { ComponentProps } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const ALLOWED_ELEMENTS = [
  "a", "blockquote", "br", "code", "del", "em", "h1", "h2", "h3",
  "h4", "h5", "h6", "hr", "input", "li", "ol", "p", "pre",
  "strong", "table", "tbody", "td", "th", "thead", "tr", "ul",
] as const;

/** Allow navigational web links only; reject script/data/file/custom protocols. */
export function safeMarkdownUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function ExternalLink({ href, children, ...props }: ComponentProps<"a">) {
  const safeHref = href ? safeMarkdownUrl(href) : "";
  if (!safeHref) return <span>{children}</span>;
  return (
    <a
      {...props}
      href={safeHref}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="ds-focus rounded-sm font-medium text-ink underline decoration-ink-3 underline-offset-[3px] transition-colors hover:decoration-ink"
    >
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

// Markdown on paper (contract ui-remodel v2 §7): headings, lists and code sit in
// the reading column with space around them. No rules or borders draw lines.
const components: Components = {
  h1: ({ children }) => <h2 className="mb-2 mt-5 text-heading text-ink first:mt-0">{children}</h2>,
  h2: ({ children }) => <h3 className="mb-2 mt-5 text-body-lg font-semibold text-ink first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mb-1.5 mt-4 text-body font-semibold text-ink first:mt-0">{children}</h4>,
  h4: ({ children }) => <h5 className="mb-1 mt-3 text-body font-semibold text-ink first:mt-0">{children}</h5>,
  h5: ({ children }) => <h6 className="mb-1 mt-3 text-body font-semibold text-ink first:mt-0">{children}</h6>,
  h6: ({ children }) => <p className="mb-1 mt-3 text-body font-semibold text-ink first:mt-0">{children}</p>,
  p: ({ children }) => <p className="my-2.5 first:mt-0 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  em: ({ children }) => <em>{children}</em>,
  del: ({ children }) => <del className="text-ink-3">{children}</del>,
  ul: ({ children }) => <ul className="my-2.5 list-disc space-y-1 pl-5 marker:text-ink-3">{children}</ul>,
  ol: ({ children, start }) => <ol start={start} className="my-2.5 list-decimal space-y-1 pl-5 marker:font-medium marker:text-ink-3">{children}</ol>,
  li: ({ children }) => <li className="pl-1">{children}</li>,
  input: ({ checked }) => (
    <input
      aria-label={checked ? "completed item" : "incomplete item"}
      className="mr-2 accent-current"
      type="checkbox"
      checked={Boolean(checked)}
      disabled
      readOnly
    />
  ),
  blockquote: ({ children }) => <blockquote className="my-3 rounded-control bg-glass px-4 py-2 text-ink-2">{children}</blockquote>,
  a: ExternalLink,
  code: ({ children, className }) => {
    const block = Boolean(className?.startsWith("language-")) || String(children).includes("\n");
    return (
      <code className={block
        ? `${className ?? ""} font-ui-mono text-meta text-ink`
        : "rounded-md bg-glass-strong px-1.5 py-0.5 font-ui-mono text-[0.88em] text-ink"}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre aria-label="Code block" tabIndex={0} className="ds-focus my-3 max-w-full overflow-x-auto rounded-card bg-surface p-4 shadow-e1">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div role="region" aria-label="Scrollable table" tabIndex={0} className="ds-focus my-3 max-w-full overflow-x-auto rounded-card bg-surface shadow-e1">
      <table className="w-full min-w-[28rem] border-collapse text-left text-meta">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-glass-strong text-ink">{children}</thead>,
  th: ({ children }) => <th className="px-3 py-2 font-semibold">{children}</th>,
  tr: ({ children }) => <tr className="even:bg-glass">{children}</tr>,
  td: ({ children }) => <td className="px-3 py-2 align-top text-ink-2">{children}</td>,
  // A thematic break stays in the document outline but draws no line.
  hr: () => <hr className="my-5 h-0 border-0" />,
};

export interface AssistantMarkdownProps {
  text: string;
  /** Marks an incomplete stopped stream for tests and assistive diagnostics. */
  partial?: boolean;
}

/**
 * Safe renderer for AVA replies. Storage and Copy retain the original source;
 * raw HTML is ignored, images are unsupported, and generated HTML never runs.
 */
export function AssistantMarkdown({ text, partial = false }: AssistantMarkdownProps) {
  return (
    <div
      data-testid="assistant-markdown"
      data-partial={partial ? "true" : "false"}
      className="min-w-0 max-w-full break-words text-body-lg font-normal text-ink"
    >
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        allowedElements={[...ALLOWED_ELEMENTS]}
        urlTransform={safeMarkdownUrl}
        components={components}
      >
        {text}
      </Markdown>
    </div>
  );
}
