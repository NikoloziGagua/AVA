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
      className="font-medium text-cyan-200 underline decoration-cyan-300/35 underline-offset-[3px] transition-colors hover:text-cyan-100 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
    >
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

const components: Components = {
  h1: ({ children }) => <h2 className="mb-2 mt-4 text-xl font-semibold leading-tight tracking-[-0.02em] text-white first:mt-0">{children}</h2>,
  h2: ({ children }) => <h3 className="mb-2 mt-4 text-lg font-semibold leading-tight tracking-[-0.015em] text-white first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mb-1.5 mt-3.5 text-base font-semibold leading-snug text-white first:mt-0">{children}</h4>,
  h4: ({ children }) => <h5 className="mb-1 mt-3 font-semibold text-white first:mt-0">{children}</h5>,
  h5: ({ children }) => <h6 className="mb-1 mt-3 font-semibold text-white first:mt-0">{children}</h6>,
  h6: ({ children }) => <p className="mb-1 mt-3 font-semibold text-white first:mt-0">{children}</p>,
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  em: ({ children }) => <em className="text-slate-100">{children}</em>,
  del: ({ children }) => <del className="text-white/50 decoration-white/35">{children}</del>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 marker:text-cyan-300/70">{children}</ul>,
  ol: ({ children, start }) => <ol start={start} className="my-2 list-decimal space-y-1 pl-5 marker:font-medium marker:text-cyan-200/75">{children}</ol>,
  li: ({ children }) => <li className="pl-1 leading-relaxed">{children}</li>,
  input: ({ checked }) => (
    <input
      aria-label={checked ? "completed item" : "incomplete item"}
      className="mr-2 accent-cyan-300"
      type="checkbox"
      checked={Boolean(checked)}
      disabled
      readOnly
    />
  ),
  blockquote: ({ children }) => <blockquote className="my-3 border-l-2 border-cyan-300/45 bg-cyan-300/[0.04] py-1 pl-3 pr-2 text-white/70">{children}</blockquote>,
  a: ExternalLink,
  code: ({ children, className }) => {
    const block = Boolean(className?.startsWith("language-")) || String(children).includes("\n");
    return (
      <code className={block
        ? `${className ?? ""} font-mono text-[12.5px] leading-relaxed text-cyan-50`
        : "rounded-md border border-white/10 bg-black/30 px-1.5 py-0.5 font-mono text-[0.88em] text-cyan-100"}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre aria-label="Code block" tabIndex={0} className="soft-scrollbar my-3 max-w-full overflow-x-auto rounded-xl border border-white/10 bg-black/45 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div role="region" aria-label="Scrollable table" tabIndex={0} className="soft-scrollbar my-3 max-w-full overflow-x-auto rounded-xl border border-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70">
      <table className="w-full min-w-[28rem] border-collapse text-left text-[13px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-white/[0.06] text-white">{children}</thead>,
  th: ({ children }) => <th className="border-b border-white/10 px-3 py-2 font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-b border-white/[0.06] px-3 py-2 align-top text-white/75">{children}</td>,
  hr: () => <hr className="my-4 border-0 border-t border-white/10" />,
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
      className="min-w-0 max-w-full break-words text-[15px] leading-[1.65] text-slate-100/90"
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
