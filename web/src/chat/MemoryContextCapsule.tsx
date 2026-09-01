import { BrainCircuit, Check, CircleOff, Database, ShieldCheck, TriangleAlert } from "lucide-react";
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
  if (status === "used") return <BrainCircuit size={13} aria-hidden="true" />;
  if (status === "no_match" || status === "suppressed") return <CircleOff size={13} aria-hidden="true" />;
  return <TriangleAlert size={13} aria-hidden="true" />;
}

export function MemoryContextCapsule({ context }: { context: MemoryContext }) {
  const used = context.status === "used";
  return (
    <details
      data-testid="memory-context"
      className={`group/memory mt-1 rounded-xl border px-3 py-2 text-[11px] ${
        used
          ? "border-violet-300/20 bg-violet-300/[0.06] text-violet-50/75"
          : "border-white/10 bg-white/[0.025] text-white/48"
      }`}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60 [&::-webkit-details-marker]:hidden">
        <Icon status={context.status} />
        <span className="font-medium tracking-wide">{labelFor(context)}</span>
        {context.project && <span className="ml-auto truncate text-[10px] text-white/35">{context.project}</span>}
        <span className="ml-auto text-[9px] uppercase tracking-[0.16em] text-white/30 group-open/memory:hidden">Details</span>
      </summary>

      <div className="mt-2 space-y-2 border-t border-white/8 pt-2 leading-relaxed">
        <p>{context.reason}</p>
        <div className="flex flex-wrap gap-1.5 text-[10px] text-white/45">
          <span className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-1">
            <Database size={10} aria-hidden="true" />
            {context.mode ? `${context.mode} retrieval` : "retrieval skipped"}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2 py-1">
            {context.semanticAvailable ? <Check size={10} aria-hidden="true" /> : <CircleOff size={10} aria-hidden="true" />}
            semantic search {context.semanticAvailable ? "available" : "unavailable"}
          </span>
        </div>
        {context.notice && <p className="text-amber-100/60">{context.notice}</p>}
        {context.selected.map((source) => (
          <article key={source.entryId} className="rounded-lg border border-white/8 bg-black/15 p-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <ShieldCheck size={12} className="shrink-0 text-emerald-300/70" aria-hidden="true" />
              <strong className="min-w-0 truncate font-medium text-white/80">{source.title}</strong>
              <span className="ml-auto shrink-0 uppercase tracking-[0.12em] text-white/30">{source.kind}</span>
            </div>
            <p className="mt-1.5 text-white/48">{source.matchReason}</p>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[9px] uppercase tracking-[0.12em] text-white/30">
              <span>source {source.sourceStatus}</span>
              <span>{source.matchMode} match</span>
              {source.sourceTruncated && <span>bounded excerpt used</span>}
            </div>
          </article>
        ))}
        <p className="text-[9px] uppercase tracking-[0.13em] text-white/25">
          This receipt contains source labels and retrieval evidence, never the private source text.
        </p>
      </div>
    </details>
  );
}
