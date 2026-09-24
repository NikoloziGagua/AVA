import { useEffect, useRef, useState } from "react";
import { BookOpen, ChevronLeft, ChevronRight, Clock3, FolderInput, GraduationCap, List, LoaderCircle, MessageSquareText, Pencil, Plus } from "lucide-react";
import { AssistantMarkdown } from "../chat/AssistantMarkdown.js";
import { Button } from "../components/ui/button.js";
import type { Note } from "./api.js";
import { noteFolderId, type FolderNode } from "./folders.js";

function shortDate(at: number): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(at);
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * One Notes page at a time, like a book: previous/next arrows, ←/→ keys,
 * a horizontal swipe, page dots with "n / N" and a numbered contents list.
 */
export function NotePager({ pages, currentId, folderName, folders, busy, onSelect, onEdit, onMove, onAsk, onNewPage }: {
  pages: Note[];
  currentId: string | null;
  folderName: string;
  folders: FolderNode[];
  busy: boolean;
  onSelect: (id: string) => void;
  onEdit: (note: Note) => void;
  onMove: (note: Note, folderId: string) => void;
  onAsk: (note: Note) => void;
  onNewPage: () => void;
}) {
  const [contentsOpen, setContentsOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const index = Math.max(0, pages.findIndex((page) => page.id === currentId));
  const page = pages[index] ?? null;
  const total = pages.length;

  const go = (next: number) => {
    const target = pages[next];
    if (!target) return;
    setMoveOpen(false);
    onSelect(target.id);
  };

  // Latest values for the window listener without re-subscribing every render.
  const nav = useRef({ index, go });
  nav.current = { index, go };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (isEditable(event.target) || document.querySelector("[role='dialog']")) return;
      event.preventDefault();
      nav.current.go(nav.current.index + (event.key === "ArrowRight" ? 1 : -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => { setMoveOpen(false); }, [page?.id]);

  if (!page) {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/[0.09] bg-black/25 px-6 py-10 text-center">
        <BookOpen size={20} className="text-white/30" />
        <p className="text-sm text-white/60">No pages in {folderName} yet.</p>
        <Button size="sm" onClick={onNewPage}><Plus size={14} />New page</Button>
      </div>
    );
  }

  const study = page.documentType === "study";
  const crumbs = page.folderPath?.map((crumb) => crumb.name).join(" / ") || folderName;

  return (
    <section aria-label="Notes pages" className="min-w-0">
      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label="Previous page"
          disabled={index === 0}
          onClick={() => go(index - 1)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-black/40 text-white/70 transition hover:border-[var(--ac)]/40 hover:text-[var(--ac)] disabled:opacity-25"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="flex min-w-0 flex-col items-center gap-2">
          <span className="hud text-[10px] tracking-[0.16em] text-white/50" aria-live="polite" data-testid="page-counter">
            PAGE {index + 1} / {total}
          </span>
          {total > 1 && total <= 24 && (
            <div className="flex flex-wrap justify-center gap-1.5">
              {pages.map((entry, at) => (
                <button
                  key={entry.id}
                  type="button"
                  aria-label={`Page ${at + 1}: ${entry.title}`}
                  aria-current={at === index ? "page" : undefined}
                  onClick={() => go(at)}
                  className={`h-2 rounded-full transition-all ${at === index ? "w-5 bg-[var(--ac)]" : "w-2 bg-white/20 hover:bg-white/45"}`}
                />
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          aria-label="Next page"
          disabled={index >= total - 1}
          onClick={() => go(index + 1)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-black/40 text-white/70 transition hover:border-[var(--ac)]/40 hover:text-[var(--ac)] disabled:opacity-25"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <article
        key={page.id}
        aria-label={page.title}
        onPointerDown={(event) => { swipe.current = { x: event.clientX, y: event.clientY }; }}
        onPointerUp={(event) => {
          const start = swipe.current;
          swipe.current = null;
          if (!start) return;
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(index + (dx < 0 ? 1 : -1));
        }}
        onPointerCancel={() => { swipe.current = null; }}
        className="min-h-[420px] touch-pan-y rounded-2xl border border-white/[0.08] bg-[#07090a]/85 px-5 py-6 shadow-[0_30px_60px_-40px_rgba(0,0,0,.95)] sm:px-9 sm:py-8"
      >
        <header className="mb-5 border-b border-white/[0.07] pb-4">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] text-white/40">
            <span className="truncate">{crumbs}</span>
            {study && (
              <span className="flex items-center gap-1 rounded-full border border-[#bb8cff]/35 bg-[#bb8cff]/10 px-2 py-0.5 text-[#d9c2ff]">
                <GraduationCap size={11} />Study
              </span>
            )}
          </div>
          <h2 className="text-xl font-semibold leading-snug text-white sm:text-2xl">{page.title}</h2>
          <p className="mt-2 flex items-center gap-1.5 text-[10px] text-white/30"><Clock3 size={10} />Updated {shortDate(page.updatedAt)} · v{page.version}</p>
        </header>
        <AssistantMarkdown text={page.content} />
      </article>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onEdit(page)}><Pencil size={13} />Edit</Button>
        <Button size="sm" variant="outline" disabled={busy} aria-expanded={moveOpen} onClick={() => setMoveOpen((open) => !open)}><FolderInput size={13} />Move</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onAsk(page)}><MessageSquareText size={13} />Ask AVA about this page</Button>
        <Button size="sm" variant="ghost" aria-expanded={contentsOpen} onClick={() => setContentsOpen((open) => !open)}><List size={13} />Contents</Button>
        {busy && <LoaderCircle size={14} className="animate-spin text-white/40" />}
      </div>

      {moveOpen && (
        <label className="mt-3 flex flex-col gap-1.5 rounded-xl border border-white/[0.08] bg-black/30 px-4 py-3 text-xs text-white/50 sm:flex-row sm:items-center">
          <span className="shrink-0">Move this page to</span>
          <select
            aria-label="Destination folder"
            value={noteFolderId(page)}
            onChange={(event) => {
              setMoveOpen(false);
              if (event.target.value !== noteFolderId(page)) onMove(page, event.target.value);
            }}
            className="h-9 min-w-0 flex-1 rounded-lg border border-white/10 bg-[#080a0b] px-3 text-sm text-white outline-none focus:border-[var(--ac)]/35"
          >
            {folders.map(({ folder, depth }) => (
              <option key={folder.id} value={folder.id}>{`${"  ".repeat(depth)}${folder.name}`}</option>
            ))}
          </select>
        </label>
      )}

      {contentsOpen && (
        <nav aria-label="Contents" className="mt-3 rounded-xl border border-white/[0.08] bg-black/30 px-3 py-3">
          <ol className="space-y-0.5">
            {pages.map((entry, at) => (
              <li key={entry.id}>
                <button
                  type="button"
                  aria-current={at === index ? "page" : undefined}
                  onClick={() => { go(at); setContentsOpen(false); }}
                  className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-xs transition ${at === index ? "bg-[var(--ac)]/[0.08] text-white" : "text-white/55 hover:bg-white/[0.04] hover:text-white"}`}
                >
                  <span className="hud w-6 shrink-0 text-right text-[10px] text-white/30">{at + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                  {entry.documentType === "study" && <GraduationCap size={11} className="shrink-0 text-[#bb8cff]" />}
                </button>
              </li>
            ))}
          </ol>
        </nav>
      )}
    </section>
  );
}
