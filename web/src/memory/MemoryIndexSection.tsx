import { useEffect, useState } from "react";
import { AlertTriangle, BookOpenCheck, Database, GitCommit, GitCompareArrows, MessageSquareText, Pencil, Pin, Search, ShieldCheck } from "lucide-react";
import {
  correctMemoryIndexEntry,
  fetchMemoryIndex,
  pinMemoryIndexThread,
  searchMemoryIndex,
  setMemoryIndexConflict,
  supersedeMemoryIndexThread,
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
  candidates = [],
  onChanged,
}: {
  result: MemoryIndexResult;
  onOpenChat?: (sessionId: string) => void;
  candidates?: MemoryIndexResult[];
  onChanged?: () => void | Promise<void>;
}) {
  const { entry, originalEntry, source, match, governance } = result;
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState(entry.summary);
  const [reason, setReason] = useState("");
  const [relationship, setRelationship] = useState<"supersede" | "conflict" | null>(null);
  const [otherThreadId, setOtherThreadId] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => { setSummary(entry.summary); }, [entry.summary]);
  const selectable = candidates.filter((candidate) =>
    candidate.lineage.threadId !== result.lineage.threadId
    && candidate.entry.privacyLevel === entry.privacyLevel
    && candidate.entry.project === entry.project
    && candidate.governance.state === "current");

  function requestId(action: string): string {
    const entropy = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `memory-${action}-${entropy}`;
  }

  async function runAction(action: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      setEditing(false);
      setRelationship(null);
      setReason("");
      setOtherThreadId("");
      await onChanged?.();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const stateTone = governance.state === "current"
    ? "border-emerald-300/20 bg-emerald-300/[0.06] text-emerald-100/75"
    : governance.state === "conflicted"
      ? "border-red-300/25 bg-red-300/[0.08] text-red-100"
      : "border-amber-300/20 bg-amber-300/[0.06] text-amber-100/70";
  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.035] p-4" data-testid="memory-index-result">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="hud text-[9px] uppercase tracking-[0.18em] text-[var(--ac)]">{entry.kind}</span>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] ${entry.captureMode === "automatic" ? "border-violet-300/20 bg-violet-300/[0.07] text-violet-100/70" : "border-white/10 text-white/45"}`}>
              {entry.captureMode === "automatic" ? "captured automatically" : "saved by request"}
            </span>
            {result.lineage.totalCheckpoints > 1 && (
              <span className={`rounded-full border px-2 py-0.5 text-[10px] ${result.lineage.isLatest ? "border-cyan-300/25 bg-cyan-300/[0.07] text-cyan-100/75" : "border-white/10 text-white/40"}`}>
                checkpoint {result.lineage.sequence} of {result.lineage.totalCheckpoints}{result.lineage.isLatest ? " / latest" : " / history"}
              </span>
            )}
            {entry.project && <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/45">{entry.project}</span>}
            <span className={`rounded-full border px-2 py-0.5 text-[10px] ${stateTone}`}>
              {governance.state}
            </span>
            {governance.pinned && <span className="rounded-full border border-cyan-300/20 bg-cyan-300/[0.06] px-2 py-0.5 text-[10px] text-cyan-100/75">pinned</span>}
            {governance.corrected && <span className="rounded-full border border-violet-300/20 bg-violet-300/[0.06] px-2 py-0.5 text-[10px] text-violet-100/75">corrected by governance</span>}
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

      {governance.state === "conflicted" && (
        <div className="mt-3 rounded-xl border border-red-300/20 bg-red-300/[0.06] px-3 py-2 text-xs text-red-100/75" role="status">
          Automatic recall is paused because this conflicts with {governance.conflictWithThreadIds.join(", ")}.
        </div>
      )}
      {governance.state === "superseded" && (
        <div className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.05] px-3 py-2 text-xs text-amber-100/70" role="status">
          Preserved history. Current replacement: {governance.supersededByThreadId}.
        </div>
      )}

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

      {governance.state === "current" && (
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Memory governance controls">
          <button
            type="button"
            disabled={busy}
            className="btn-deck inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
            onClick={() => void runAction(() => pinMemoryIndexThread({
              threadId: result.lineage.threadId,
              expectedVersion: governance.threadVersion,
              pinned: !governance.pinned,
              reason: governance.pinned ? "Niko removed this memory's priority pin." : "Niko marked this memory as important.",
              project: entry.project,
              requestId: requestId(governance.pinned ? "unpin" : "pin"),
            }))}
          >
            <Pin size={13} /> {governance.pinned ? "Unpin" : "Pin"}
          </button>
          <button type="button" disabled={busy} className="btn-deck inline-flex items-center gap-1.5 px-3 py-1.5 text-xs" onClick={() => { setEditing((value) => !value); setRelationship(null); }}>
            <Pencil size={13} /> Correct
          </button>
          {selectable.length > 0 && (
            <>
              <button type="button" disabled={busy} className="btn-deck px-3 py-1.5 text-xs" onClick={() => { setRelationship("supersede"); setEditing(false); }}>
                Mark obsolete
              </button>
              <button type="button" disabled={busy} className="btn-deck inline-flex items-center gap-1.5 px-3 py-1.5 text-xs" onClick={() => { setRelationship("conflict"); setEditing(false); }}>
                <GitCompareArrows size={13} /> Mark conflict
              </button>
            </>
          )}
        </div>
      )}

      {editing && (
        <form
          className="mt-3 space-y-2 rounded-xl border border-violet-300/15 bg-violet-300/[0.04] p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void runAction(() => correctMemoryIndexEntry({
              id: entry.id,
              expectedVersion: governance.threadVersion,
              summary,
              reason,
              project: entry.project,
              requestId: requestId("correct"),
            }));
          }}
        >
          <label className="block text-[10px] uppercase tracking-[0.15em] text-white/45" htmlFor={`memory-summary-${entry.id}`}>Corrected compact summary</label>
          <textarea id={`memory-summary-${entry.id}`} value={summary} onChange={(event) => setSummary(event.target.value)} rows={4} required className="w-full rounded-xl border border-white/10 bg-black/30 p-3 text-sm text-white/75 outline-none focus:border-[var(--ac)]/40" />
          <input value={reason} onChange={(event) => setReason(event.target.value)} required placeholder="Why is this correction needed?" aria-label="Correction reason" className="h-9 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-white/75 outline-none" />
          <p className="text-[10px] leading-relaxed text-white/35">This appends a correction record. It does not rewrite the checkpoint or claim the source said the corrected text.</p>
          <div className="flex gap-2"><button type="submit" disabled={busy || !reason.trim() || !summary.trim()} className="btn-deck px-3 py-1.5 text-xs">Save correction</button><button type="button" onClick={() => setEditing(false)} className="px-3 py-1.5 text-xs text-white/45">Cancel</button></div>
        </form>
      )}

      {relationship && (
        <form
          className="mt-3 space-y-2 rounded-xl border border-white/10 bg-black/20 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            const other = selectable.find((candidate) => candidate.lineage.threadId === otherThreadId);
            if (!other) return;
            void runAction(() => relationship === "supersede"
              ? supersedeMemoryIndexThread({
                threadId: result.lineage.threadId,
                expectedVersion: governance.threadVersion,
                replacementThreadId: other.lineage.threadId,
                replacementExpectedVersion: other.governance.threadVersion,
                reason,
                project: entry.project,
                requestId: requestId("supersede"),
              })
              : setMemoryIndexConflict({
                mode: "open",
                threadId: result.lineage.threadId,
                expectedVersion: governance.threadVersion,
                otherThreadId: other.lineage.threadId,
                otherExpectedVersion: other.governance.threadVersion,
                reason,
                project: entry.project,
                requestId: requestId("conflict"),
              }));
          }}
        >
          <label className="block text-xs text-white/55" htmlFor={`memory-related-${entry.id}`}>{relationship === "supersede" ? "Replacement memory" : "Conflicting memory"}</label>
          <select id={`memory-related-${entry.id}`} value={otherThreadId} onChange={(event) => setOtherThreadId(event.target.value)} required className="h-9 w-full rounded-xl border border-white/10 bg-[#0d1520] px-3 text-xs text-white/75">
            <option value="">Choose a current memory…</option>
            {selectable.map((candidate) => <option key={candidate.lineage.threadId} value={candidate.lineage.threadId}>{candidate.entry.title} — {candidate.lineage.threadId}</option>)}
          </select>
          <input value={reason} onChange={(event) => setReason(event.target.value)} required placeholder={relationship === "supersede" ? "Why is the old memory obsolete?" : "What contradicts?"} aria-label="Governance reason" className="h-9 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-xs text-white/75" />
          <div className="flex gap-2"><button type="submit" disabled={busy || !reason.trim() || !otherThreadId} className="btn-deck px-3 py-1.5 text-xs">{relationship === "supersede" ? "Confirm replacement" : "Pause both as conflicting"}</button><button type="button" onClick={() => setRelationship(null)} className="px-3 py-1.5 text-xs text-white/45">Cancel</button></div>
        </form>
      )}

      {governance.state === "conflicted" && governance.conflictWithThreadIds.map((threadId) => {
        const other = candidates.find((candidate) => candidate.lineage.threadId === threadId);
        if (!other) return null;
        return (
          <button
            key={threadId}
            type="button"
            disabled={busy}
            className="btn-deck mt-3 px-3 py-1.5 text-xs"
            onClick={() => void runAction(() => setMemoryIndexConflict({
              mode: "resolve",
              threadId: result.lineage.threadId,
              expectedVersion: governance.threadVersion,
              otherThreadId: threadId,
              otherExpectedVersion: other.governance.threadVersion,
              reason: `Niko selected ${result.lineage.threadId} as the current memory over ${threadId}.`,
              project: entry.project,
              requestId: requestId("resolve"),
            }))}
          >
            Keep this; supersede {other.entry.title}
          </button>
        );
      })}
      {actionError && <div className="mt-3 rounded-xl border border-red-300/20 bg-red-300/[0.06] px-3 py-2 text-xs text-red-100" role="alert">{actionError}. Refresh and try again if this memory changed.</div>}

      <details className="mt-4 rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2">
        <summary className="cursor-pointer text-xs text-white/55">Why AVA found this</summary>
        <div className="mt-2 space-y-2 text-xs leading-relaxed text-white/50">
          <p>{match.reason}</p>
          <p>{source.reason}</p>
          <p>{source.type === "improvement_record"
            ? "Source verification checks the immutable improvement record and confirms its exact Git commit remains on AVA's current branch. It proves what code changed, not that every capability succeeds in every environment."
            : "Source verification checks that the linked conversation is unchanged; it does not independently certify the summary."}</p>
          {source.type === "improvement_record" ? (
            <p className="inline-flex items-center gap-1.5"><GitCommit size={12} />Source: {source.label}{source.commitSha ? ` / ${source.commitSha}` : ""} / immutable product record</p>
          ) : (
            <p>
              Source: {source.label} / messages {source.fromMessageId}-{source.throughMessageId}
              {source.sessionId ? " / linked" : " / source link unavailable"}
            </p>
          )}
          <p>Captured {new Date(entry.createdAt).toLocaleString()} / memory {entry.id}</p>
          {entry.captureReason && <p>Capture provenance: {entry.captureReason}</p>}
          <p>
            Lineage: {entry.checkpointKind.replace("_", " ")} checkpoint {result.lineage.sequence} of {result.lineage.totalCheckpoints}
            {result.lineage.parentEntryId ? ` / follows ${result.lineage.parentEntryId}` : " / starts this thread"}
          </p>
          {result.lineage.reason && <p>Why this checkpoint exists: {result.lineage.reason}</p>}
          <p>Thread: {result.lineage.threadId}{result.lineage.isLatest ? " / current checkpoint" : " / preserved history"}</p>
          <p>Governance version {governance.threadVersion} / {governance.retrievalEligible ? "eligible for retrieval" : "not used automatically"}</p>
          {governance.corrected && (
            <div className="rounded-lg border border-violet-300/15 bg-violet-300/[0.04] p-2">
              <p>Correction: {governance.correctionReason}</p>
              <p className="mt-1">Original compact summary: {originalEntry.summary}</p>
              <p className="mt-1">The source verifies its conversation range, not the later user correction.</p>
            </div>
          )}
          {governance.events.length > 0 && (
            <div>
              <p className="mb-1 text-white/60">Governance history</p>
              <ul className="space-y-1">
                {governance.events.map((item) => <li key={item.id}>{item.kind.replace("_", " ")} by {item.actor} — {item.reason} ({new Date(item.createdAt).toLocaleString()})</li>)}
              </ul>
            </div>
          )}
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
    try { setResponse(await searchMemoryIndex({ query: value, project, includeHistory: true })); }
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
              <h2 id="memory-index-title" className="text-xl font-medium text-white/90">Research, ideas & improvements</h2>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-white/45">
                Completed research, ideas you meaningfully develop with AVA, and committed AVA product improvements are captured automatically. Material decisions and refinements become linked, immutable checkpoints rather than overwriting earlier conclusions. You can still say "remember this" for anything else. Search finds the compact summary, then AVA checks the original conversation or Git commit before trusting it.
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
              No source-linked memory matched. Finish research, develop an idea, ship an AVA improvement, or tell AVA "remember this" explicitly.
            </div>
          )}
          <div className="grid gap-3 xl:grid-cols-2">
            {response?.results.map((result) => (
              <MemoryIndexCard key={result.entry.id} result={result} candidates={response.results} onOpenChat={onOpenChat} onChanged={() => query.trim() ? search() : loadRecent()} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
