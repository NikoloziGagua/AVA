import { BrainCircuit, Check, ChevronDown, CircleOff, Database, ShieldCheck, TriangleAlert } from "lucide-react";
import { cn } from "../design/cn.js";
import type { MemoryContext } from "./memory-context.js";

function labelFor(context: MemoryContext): string {
  switch (context.status) {
    case "used": return `Memory used · ${context.selected.length} source${context.selected.length === 1 ? "" : "s"}`;
    case "no_match": return "No relevant memory used";
    case "suppressed": return "Memory not needed";
    case "unavailable": return "Memory unavailable";
    case "error": return "Memory check failed";
  }
}

function Icon({ status }: { status: MemoryContext["status"] }) {
  if (status === "used") return <BrainCircuit size={15} aria-hidden="true" />;
  if (status === "no_match" || status === "suppressed") return <CircleOff size={15} aria-hidden="true" />;
  return <TriangleAlert size={15} aria-hidden="true" />;
}

const tag = "inline-flex items-center gap-1.5 rounded-full bg-glass px-2.5 py-1";

/** Which memory AVA used for this reply, and why: labels and evidence only, never private text. */
export function MemoryContextCapsule({ context }: { context: MemoryContext }) {
  const used = context.status === "used";
  const failed = context.status === "unavailable" || context.status === "error";
  return (
    <details
      data-testid="memory-context"
      className={cn(
        "group/memory rounded-card px-4 py-2.5 text-meta",
        used ? "bg-info-soft text-ink" : failed ? "bg-warning-soft text-ink" : "bg-glass text-ink-2",
      )}
    >
      <summary className="ds-focus -mx-1 flex min-h-8 cursor-pointer list-none items-center gap-2 rounded-control px-1 [&::-webkit-details-marker]:hidden">
        <span className={cn("shrink-0", used ? "text-info" : failed ? "text-warning" : "text-ink-3")}><Icon status={context.status} /></span>
        <span className="font-medium">{labelFor(context)}</span>
        {context.project && <span className="ml-auto hidden min-w-0 truncate text-label text-ink-3 sm:block">{context.project}</span>}
        <ChevronDown size={15} aria-hidden="true" className={cn("ml-auto shrink-0 text-ink-3 transition-transform group-open/memory:rotate-180", context.project && "sm:ml-0")} />
      </summary>

      <div className="mt-3 grid gap-3">
        <p className="text-ink-2">{context.reason}</p>
        {context.project && <p className="text-ink-2 sm:hidden">Project: {context.project}</p>}
        <div className="flex flex-wrap gap-1.5 text-label text-ink-2">
          <span className={tag}>
            <Database size={13} aria-hidden="true" />
            {context.mode ? `${context.mode} retrieval` : "retrieval skipped"}
          </span>
          <span className={tag}>
            {context.semanticAvailable ? <Check size={13} aria-hidden="true" /> : <CircleOff size={13} aria-hidden="true" />}
            semantic search {context.semanticAvailable ? "available" : "unavailable"}
          </span>
        </div>
        {context.notice && <p className="text-warning">{context.notice}</p>}
        {context.selected.map((source) => (
          <article key={source.entryId} className="grid gap-1.5 rounded-control bg-surface p-3 shadow-e1">
            <div className="flex min-w-0 items-center gap-2">
              <ShieldCheck size={14} className="shrink-0 text-success" aria-hidden="true" />
              <strong className="min-w-0 truncate font-medium text-ink">{source.title}</strong>
              <span className="ml-auto shrink-0 font-ui-mono text-label uppercase text-ink-3">{source.kind}</span>
            </div>
            <p className="text-ink-2">{source.matchReason}</p>
            <div className="flex flex-wrap gap-x-3 gap-y-1 font-ui-mono text-label uppercase text-ink-3">
              <span>source {source.sourceStatus}</span>
              <span>{source.matchMode} match</span>
              {source.sourceTruncated && <span>bounded excerpt used</span>}
            </div>
          </article>
        ))}
        <p className="text-label text-ink-3">
          This receipt contains source labels and retrieval evidence, never the private source text.
        </p>
      </div>
    </details>
  );
}
