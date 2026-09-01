import { useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  BrainCircuit,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  FileText,
  MessageSquareText,
  Pin,
  RefreshCw,
  Scale,
} from "lucide-react";
import type { MemoryIndexResult, MemoryIndexSearchResponse } from "../api.js";
import type { Note, NoteProject } from "./api.js";

type ProjectBriefProps = {
  project: NoteProject;
  notes: readonly Note[];
  memory: MemoryIndexSearchResponse | null;
  memoryLoading: boolean;
  memoryError: string | null;
  onRetryMemory: () => void;
  onOpenNote: (note: Note) => void;
  onOpenChat?: (sessionId: string) => void;
};

function sameProject(result: MemoryIndexResult, project: NoteProject): boolean {
  return result.entry.privacyLevel === "project"
    && result.entry.project?.trim().toLocaleLowerCase() === project.name.trim().toLocaleLowerCase();
}

function statusTone(result: MemoryIndexResult): { label: string; className: string } {
  if (result.source.status === "changed") {
    return { label: "Source changed", className: "border-amber-300/20 bg-amber-300/[0.06] text-amber-100/80" };
  }
  if (result.source.status === "unavailable") {
    return { label: "Source unavailable", className: "border-red-300/20 bg-red-300/[0.06] text-red-100/75" };
  }
  if (!result.governance.retrievalEligible) {
    return { label: result.governance.state, className: "border-white/10 bg-white/[0.03] text-white/40" };
  }
  return { label: "Source verified", className: "border-emerald-300/20 bg-emerald-300/[0.06] text-emerald-100/75" };
}

function BriefNoteList({
  title,
  empty,
  icon: Icon,
  notes,
  onOpen,
}: {
  title: string;
  empty: string;
  icon: typeof Pin;
  notes: readonly Note[];
  onOpen: (note: Note) => void;
}) {
  return (
    <section className="rounded-xl border border-white/[0.07] bg-black/25 p-3.5">
      <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold text-white/60">
        <Icon size={13} className="text-[var(--ac)]" />{title}
        <span className="ml-auto hud text-[9px] text-white/25">{notes.length}</span>
      </div>
      {notes.length ? (
        <div className="space-y-1.5">
          {notes.slice(0, 3).map((note) => (
            <button key={note.id} type="button" onClick={() => onOpen(note)}
              className="block w-full truncate rounded-lg border border-transparent px-2 py-1.5 text-left text-[11px] text-white/55 transition hover:border-white/10 hover:bg-white/[0.035] hover:text-white">
              {note.title}
            </button>
          ))}
        </div>
      ) : <p className="text-[10px] leading-4 text-white/25">{empty}</p>}
    </section>
  );
}

function MemoryCard({ result, onOpenChat }: { result: MemoryIndexResult; onOpenChat?: (sessionId: string) => void }) {
  const tone = statusTone(result);
  const sourceChat = result.source.type === "conversation_range" ? result.source.sessionId : null;
  return (
    <article className="rounded-xl border border-white/[0.07] bg-black/30 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full border px-2 py-1 hud text-[8px] uppercase tracking-[0.1em] ${tone.className}`}>{tone.label}</span>
        {result.governance.pinned && <span className="hud text-[8px] text-[#f6c76c]">PINNED</span>}
        <span className="ml-auto hud text-[8px] text-white/25">{result.entry.kind}</span>
      </div>
      <h4 className="mt-3 text-xs font-semibold text-white/75">{result.entry.title}</h4>
      <p className="mt-1.5 line-clamp-3 text-[10px] leading-[1.55] text-white/38">{result.entry.summary}</p>
      {(result.entry.conclusions.length > 0 || result.entry.nextSteps.length > 0) && (
        <div className="mt-3 grid gap-2 border-t border-white/[0.06] pt-3 sm:grid-cols-2">
          <div>
            <span className="hud text-[8px] text-white/25">CONCLUSIONS</span>
            <p className="mt-1 line-clamp-2 text-[9px] leading-4 text-white/42">{result.entry.conclusions[0] ?? "None recorded"}</p>
          </div>
          <div>
            <span className="hud text-[8px] text-white/25">NEXT STEP</span>
            <p className="mt-1 line-clamp-2 text-[9px] leading-4 text-white/42">{result.entry.nextSteps[0] ?? "None recorded"}</p>
          </div>
        </div>
      )}
      <div className="mt-3 flex items-center gap-2 border-t border-white/[0.06] pt-3 text-[9px] text-white/28">
        <span className="truncate">{result.source.label}</span>
        {sourceChat && onOpenChat && (
          <button type="button" onClick={() => onOpenChat(sourceChat)}
            className="ml-auto flex shrink-0 items-center gap-1.5 rounded-md border border-white/10 px-2 py-1 text-white/45 transition hover:border-[var(--ac)]/25 hover:text-[var(--ac)]">
            <MessageSquareText size={11} />Open source chat
          </button>
        )}
      </div>
      <details className="mt-2 rounded-lg border border-white/[0.06] bg-white/[0.018] px-3 py-2 text-[9px] text-white/32">
        <summary className="cursor-pointer select-none hud text-[8px] tracking-[0.1em] text-white/35">EVIDENCE DETAILS</summary>
        <div className="mt-2 space-y-1.5 leading-4">
          <p>{result.source.reason}</p>
          <p>Memory state: {result.governance.state}. Retrieval {result.governance.retrievalEligible ? "eligible" : "excluded"}. Checkpoint {result.lineage.sequence} of {result.lineage.totalCheckpoints}.</p>
        </div>
      </details>
    </article>
  );
}

export function ProjectBrief({
  project,
  notes,
  memory,
  memoryLoading,
  memoryError,
  onRetryMemory,
  onOpenNote,
  onOpenChat,
}: ProjectBriefProps) {
  const [expanded, setExpanded] = useState(true);
  const projectMemory = useMemo(
    () => (memory?.results ?? []).filter((result) => sameProject(result, project)).slice(0, 6),
    [memory, project],
  );
  const priorities = notes.filter((note) => note.pinned || note.section === "priorities");
  const decisions = notes.filter((note) => note.section === "decisions");
  const documentation = notes.filter((note) => note.section === "documentation");
  const openWork = notes.filter((note) => note.status === "doing" || note.status === "review");
  const evidenceNeedsAttention = projectMemory.filter((result) => !result.usable || result.source.status !== "verified").length;

  return (
    <section className="mb-5 overflow-hidden rounded-2xl border border-[var(--ac)]/15 bg-[radial-gradient(circle_at_top_left,rgba(92,242,255,0.07),transparent_42%),rgba(0,0,0,0.28)]" aria-labelledby="project-brief-title">
      <header className="flex items-start gap-3 px-4 py-4 sm:px-5">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--ac)]/20 bg-[var(--ac)]/[0.06] text-[var(--ac)]"><BrainCircuit size={16} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="project-brief-title" className="text-sm font-semibold text-white">Project brief</h3>
            <span className="rounded-full border border-white/10 px-2 py-0.5 hud text-[8px] tracking-[0.12em] text-white/35">LIVE · SOURCE-LINKED</span>
            {evidenceNeedsAttention > 0 && <span className="flex items-center gap-1 text-[9px] text-amber-100/65"><AlertTriangle size={11} />{evidenceNeedsAttention} source warning{evidenceNeedsAttention === 1 ? "" : "s"}</span>}
          </div>
          <p className="mt-1 text-[10px] leading-4 text-white/35">A current view assembled from this project's Notes and project-scoped memory. It does not generate a second summary or replace the attached sources.</p>
        </div>
        <button type="button" aria-expanded={expanded} aria-controls="project-brief-content" onClick={() => setExpanded((value) => !value)}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 hud text-[8px] text-white/40 transition hover:text-white">
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}{expanded ? "COLLAPSE" : "EXPAND"}
        </button>
      </header>

      {expanded && (
        <div id="project-brief-content" className="border-t border-white/[0.07] p-4 sm:p-5">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <BriefNoteList title="Priorities" empty="No priority is pinned yet." icon={Pin} notes={priorities} onOpen={onOpenNote} />
            <BriefNoteList title="Open work" empty="Nothing is in Doing or Review." icon={Clock3} notes={openWork} onOpen={onOpenNote} />
            <BriefNoteList title="Decisions" empty="No decision has been recorded." icon={Scale} notes={decisions} onOpen={onOpenNote} />
            <BriefNoteList title="Stable context" empty="No documentation note exists yet." icon={BookOpen} notes={documentation} onOpen={onOpenNote} />
          </div>

          <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 hud text-[9px] tracking-[0.14em] text-white/45"><FileText size={12} className="text-[var(--ac)]" />INDEXED PROJECT KNOWLEDGE</div>
              <p className="mt-1 text-[9px] leading-4 text-white/25">Only entries explicitly scoped to {project.name} appear here; personal or other-project memories are excluded.</p>
            </div>
            {!memoryLoading && <button type="button" onClick={onRetryMemory} className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 hud text-[8px] text-white/35 hover:text-white"><RefreshCw size={11} />REFRESH</button>}
          </div>

          {memoryLoading ? (
            <div className="mt-3 flex min-h-24 items-center justify-center rounded-xl border border-white/[0.06] bg-black/20 text-[10px] text-white/30"><RefreshCw size={12} className="mr-2 animate-spin" />Checking indexed project knowledge…</div>
          ) : memoryError ? (
            <div className="mt-3 flex items-center gap-3 rounded-xl border border-red-300/20 bg-red-300/[0.05] px-4 py-3 text-[10px] text-red-100/70">
              <AlertTriangle size={13} /><span className="flex-1">{memoryError}</span><button type="button" onClick={onRetryMemory} className="rounded-md border border-red-200/15 px-2 py-1 hud text-[8px]">RETRY</button>
            </div>
          ) : projectMemory.length ? (
            <div className="mt-3 grid gap-3 xl:grid-cols-2">{projectMemory.map((result) => <MemoryCard key={result.entry.id} result={result} onOpenChat={onOpenChat} />)}</div>
          ) : (
            <div className="mt-3 rounded-xl border border-dashed border-white/[0.08] bg-black/20 px-4 py-5 text-center">
              <CheckCircle2 size={15} className="mx-auto text-white/20" />
              <p className="mt-2 text-[10px] text-white/35">No source-linked memory is scoped to this project yet.</p>
              <p className="mt-1 text-[9px] text-white/22">Ask AVA to remember a conclusion or research result under “{project.name}”.</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
