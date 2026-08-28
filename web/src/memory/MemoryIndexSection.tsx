import { useEffect, useState } from "react";
import { AlertTriangle, BookOpenCheck, Database, MessageSquareText, Search, ShieldCheck } from "lucide-react";
import {
  fetchMemoryIndex,
  searchMemoryIndex,
  type MemoryIndexResult,
  type MemoryIndexSearchResponse,
} from "../api.js";

function statusTone(status: MemoryIndexResult["source"]["status"]): string {
  if (status === "verified") return "border-emerald-300/25 bg-emerald-300/[0.08] text-emerald-200";
  if (status === "changed") return "border-amber-300/25 bg-amber-300/[0.08] text-amber-100";
  return "border-red-300/25 bg-red-300/[0.08] text-red-200";
}

function EvidenceList({ label, values }: { label: string; values: string[] }) {
  if (!values.length) return null;
  return (
    <div>
      <div className="hud mb-1 text-[9px] uppercase tracking-[0.18em] text-white/35">{label}</div>
      <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-white/65">
        {values.map((value) => <li key={value}>{value}</li>)}
      </ul>
    </div>
  );
}

export function MemoryIndexCard({
  result,
  onOpenChat,
}: {
  result: MemoryIndexResult;
  onOpenChat?: (sessionId: string) => void;
}) {
  const { entry, source, match } = result;
  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.035] p-4" data-testid="memory-index-result">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="hud text-[9px] uppercase tracking-[0.18em] text-[var(--ac)]">{entry.kind}</span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] ${entry.captureMode === "automatic" ? "border-violet-300/20 bg-violet-300/[0.07] text-violet-100/70" : "border-white/10 text-white/45"}`}>
              {entry.captureMode === "automatic" ? "captured automatically" : "saved by request"}
            </span>
            {entry.project && <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/45">{entry.project}</span>}
            <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/45">
              {result.match.mode === "hybrid"
                ? "semantic + keyword"
                : result.match.mode === "semantic"
                  ? "semantic match"
                  : result.match.mode === "lexical"
                    ? "keyword fallback"
                    : entry.embeddingStatus === "ready"
                      ? "embedding ready"
                      : "keyword ready"}
            </span>
          </div>
          <h3 className="text-base font-medium text-white/90">{entry.title}</h3>
        </div>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] ${statusTone(source.status)}`}>
          {source.status === "verified" ? <ShieldCheck size={12} /> : <AlertTriangle size={12} />}
          source {source.status}
        </span>
      </div>

      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-white/70">{entry.summary}</p>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <EvidenceList label="Conclusions" values={entry.conclusions} />
        <EvidenceList label="Open questions" values={entry.openQuestions} />
        <EvidenceList label="Next steps" values={entry.nextSteps} />
      </div>

      {entry.tags.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {entry.tags.map((tag) => <span key={tag} className="rounded-full bg-white/[0.055] px-2 py-1 text-[10px] text-white/50">#{tag}</span>)}
        </div>
      )}

      <details className="mt-4 rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2">
        <summary className="cursor-pointer text-xs text-white/55">Why AVA found this</summary>
        <div className="mt-2 space-y-2 text-xs leading-relaxed text-white/50">
          <p>{match.reason}</p>
          <p>{source.reason}</p>
          <p>Source verification checks that the linked conversation is unchanged; it does not independently certify the summary.</p>
          <p>
            Source: {source.label} / messages {source.fromMessageId}-{source.throughMessageId}
            {source.sessionId ? " / linked" : " / source link unavailable"}
          </p>
          <p>Captured {new Date(entry.createdAt).toLocaleString()} / memory {entry.id}</p>
          {entry.captureReason && <p>Capture provenance: {entry.captureReason}</p>}
          {source.sessionId && result.usable && onOpenChat && (
            <button
              type="button"
              className="btn-deck mt-1 inline-flex items-center gap-2 px-3 py-1.5"
              onClick={() => onOpenChat(source.sessionId!)}
            >
              <MessageSquareText size={13} />
              Open source chat
            </button>
          )}
        </div>
      </details>
    </article>
  );
}

export function MemoryIndexSection({ onOpenChat }: { onOpenChat?: (sessionId: string) => void }) {
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("");
  const [response, setResponse] = useState<MemoryIndexSearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadRecent(projectValue = project) {
    setLoading(true);
    setError(null);
    try { setResponse(await fetchMemoryIndex(projectValue)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  }

  async function search() {
    const value = query.trim();
    if (!value) { await loadRecent(); return; }
    setLoading(true);
    setError(null);
    try { setResponse(await searchMemoryIndex({ query: value, project })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  }

  useEffect(() => { void loadRecent(""); }, []);

  return (
    <section className="lg:col-span-12" data-panel-section aria-labelledby="memory-index-title">
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-[linear-gradient(145deg,rgba(92,242,255,0.06),rgba(255,255,255,0.025))]">
        <div className="border-b border-white/[0.08] p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-2 flex items-center gap-2 text-[var(--ac)]">
                <Database size={17} />
                <span className="hud text-[10px] uppercase tracking-[0.22em]">Source-linked recall</span>
              </div>
              <h2 id="memory-index-title" className="text-xl font-medium text-white/90">Research & idea index</h2>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-white/45">
                Completed research and ideas you meaningfully develop with AVA are captured automatically. You can still say "remember this" for anything else. Search finds the compact summary, then AVA checks the original conversation before trusting it.
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-[10px] text-white/45">
              <BookOpenCheck size={13} />
              automatic + explicit
            </div>
          </div>

          <div className="mt-5 grid gap-2 md:grid-cols-[minmax(0,1fr)_220px_auto]">
            <label className="relative block">
              <span className="sr-only">Search indexed memories</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/30" size={15} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") void search(); }}
                placeholder="Ask differently: what did we decide about memory?"
                className="h-10 w-full rounded-xl border border-white/10 bg-black/30 pl-9 pr-3 text-sm text-white/80 outline-none placeholder:text-white/25 focus:border-[var(--ac)]/50"
              />
            </label>
            <label>
              <span className="sr-only">Project boundary</span>
              <input
                value={project}
                onChange={(event) => setProject(event.target.value)}
                placeholder="Project (optional)"
                className="h-10 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white/80 outline-none placeholder:text-white/25 focus:border-[var(--ac)]/50"
              />
            </label>
            <button type="button" onClick={() => void search()} disabled={loading} className="btn-deck h-10 px-4">
              {loading ? "Searching..." : "Search"}
            </button>
          </div>
        </div>

        <div className="p-5">
          {response?.notice && (
            <div className="mb-4 rounded-xl border border-amber-200/15 bg-amber-200/[0.05] px-3 py-2 text-xs text-amber-100/70" role="status">
              {response.notice}
            </div>
          )}
          {error && <div className="rounded-xl border border-red-300/20 bg-red-300/[0.06] px-3 py-2 text-xs text-red-200" role="alert">{error}</div>}
          {!error && !loading && response?.results.length === 0 && (
            <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-white/35">
              No source-linked memory matched. Finish a research or developed-idea discussion, or tell AVA "remember this" explicitly.
            </div>
          )}
          <div className="grid gap-3 xl:grid-cols-2">
            {response?.results.map((result) => (
              <MemoryIndexCard key={result.entry.id} result={result} onOpenChat={onOpenChat} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
