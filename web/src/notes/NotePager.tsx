import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, ChevronLeft, ChevronRight, Clock3, FileText, FolderInput, GraduationCap, List, LoaderCircle, MessageSquareText, Pencil, Plus, Rows3 } from "lucide-react";
import { AssistantMarkdown } from "../chat/AssistantMarkdown.js";
import { Button } from "../components/ui/button.js";
import type { Note } from "./api.js";
import { pageLayoutForWidth, paginateDocument, type DocumentPage } from "./documentPagination.js";
import { noteFolderId, type FolderNode } from "./folders.js";

function shortDate(at: number): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(at);
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function storageKey(id: string): string {
  return `ava:notes-reading-position:${id}`;
}

function savedAnchor(id: string): string | null {
  try {
    const value = window.localStorage.getItem(storageKey(id));
    return value && value.length <= 80 ? value : null;
  } catch {
    return null;
  }
}

function rememberAnchor(id: string, anchor: string): void {
  try { window.localStorage.setItem(storageKey(id), anchor); } catch { /* reading position is optional */ }
}

function anchorBlock(anchor: string | null): number | null {
  const match = anchor ? /^block-(\d+)-/.exec(anchor) : null;
  return match ? Number(match[1]) : null;
}

function closestPage(pages: DocumentPage[], anchor: string | null): DocumentPage | null {
  if (!pages.length) return null;
  const exact = pages.find((page) => page.anchor === anchor);
  if (exact) return exact;
  const desired = anchorBlock(anchor);
  if (desired === null) return pages[0] ?? null;
  return pages.reduce((best, page) => {
    const candidate = anchorBlock(page.anchor) ?? 0;
    const bestAt = anchorBlock(best.anchor) ?? 0;
    return Math.abs(candidate - desired) < Math.abs(bestAt - desired) ? page : best;
  }, pages[0]!);
}

/** A book-like reader for derived pages inside one authoritative Note file. */
export function NotePager({ note, folderName, folders, busy, onEdit, onMove, onAsk, onNewFile }: {
  note: Note | null;
  folderName: string;
  folders: FolderNode[];
  busy: boolean;
  onEdit: (note: Note) => void;
  onMove: (note: Note, folderId: string) => void;
  onAsk: (note: Note) => void;
  onNewFile: () => void;
}) {
  const [contentsOpen, setContentsOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [fullDocument, setFullDocument] = useState(false);
  const [position, setPosition] = useState<{ noteId: string; anchor: string | null }>({ noteId: "", anchor: null });
  const [readerWidth, setReaderWidth] = useState(() => typeof window === "undefined" ? 900 : window.innerWidth);
  const reader = useRef<HTMLDivElement | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const measure = () => {
      const width = reader.current?.getBoundingClientRect().width || window.innerWidth;
      if (width > 0) setReaderWidth(Math.round(width));
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (reader.current) observer?.observe(reader.current);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);

  const pages = useMemo(
    () => note ? paginateDocument(note.content, pageLayoutForWidth(readerWidth)) : [],
    [note?.id, note?.version, note?.content, readerWidth],
  );
  const effectiveAnchor = note
    ? position.noteId === note.id ? position.anchor : savedAnchor(note.id)
    : null;
  const current = closestPage(pages, effectiveAnchor);
  const index = current ? pages.indexOf(current) : 0;
  const total = pages.length;

  useEffect(() => {
    setContentsOpen(false);
    setMoveOpen(false);
    setFullDocument(false);
  }, [note?.id]);

  useEffect(() => {
    if (!note || !current || current.anchor === effectiveAnchor) return;
    setPosition({ noteId: note.id, anchor: current.anchor });
    rememberAnchor(note.id, current.anchor);
  }, [note?.id, current?.anchor, effectiveAnchor]);

  const go = (next: number) => {
    const target = pages[next];
    if (!target || !note) return;
    setMoveOpen(false);
    setPosition({ noteId: note.id, anchor: target.anchor });
    rememberAnchor(note.id, target.anchor);
  };

  const nav = useRef({ index, go, fullDocument });
  nav.current = { index, go, fullDocument };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (isEditable(event.target) || document.querySelector("[role='dialog']") || nav.current.fullDocument) return;
      event.preventDefault();
      nav.current.go(nav.current.index + (event.key === "ArrowRight" ? 1 : -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!note || !current) {
    return (
      <div ref={reader} className="flex min-h-72 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/[0.09] bg-black/25 px-6 py-10 text-center">
        <BookOpen size={20} className="text-white/30" />
        <p className="text-sm text-white/60">No files in {folderName} yet.</p>
        <Button size="sm" onClick={onNewFile}><Plus size={14} />New file</Button>
      </div>
    );
  }

  const study = note.documentType === "study";
  const crumbs = note.folderPath?.map((crumb) => crumb.name).join(" / ") || folderName;
  const shownMarkdown = fullDocument ? note.content : current.markdown;

  return (
    <section ref={reader} aria-label="Note document" className="min-w-0">
      <div className="mb-3 flex items-center justify-between gap-2">
        <button type="button" aria-label="Previous page" disabled={fullDocument || index === 0} onClick={() => go(index - 1)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-black/40 text-white/70 transition hover:border-[var(--ac)]/40 hover:text-[var(--ac)] disabled:opacity-25">
          <ChevronLeft size={18} />
        </button>
        <div className="flex min-w-0 flex-col items-center gap-2">
          <span className="hud text-[10px] tracking-[0.16em] text-white/50" aria-live="polite" data-testid="page-counter">
            {fullDocument ? "FULL DOCUMENT" : `PAGE ${index + 1} / ${total}`}
          </span>
          {!fullDocument && total > 1 && total <= 24 && (
            <div className="flex flex-wrap justify-center gap-1.5">
              {pages.map((page, at) => (
                <button key={page.anchor} type="button" aria-label={`Page ${at + 1}: ${page.title}`} aria-current={at === index ? "page" : undefined}
                  onClick={() => go(at)} className={`h-2 rounded-full transition-all motion-reduce:transition-none ${at === index ? "w-5 bg-[var(--ac)]" : "w-2 bg-white/20 hover:bg-white/45"}`} />
              ))}
            </div>
          )}
        </div>
        <button type="button" aria-label="Next page" disabled={fullDocument || index >= total - 1} onClick={() => go(index + 1)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-black/40 text-white/70 transition hover:border-[var(--ac)]/40 hover:text-[var(--ac)] disabled:opacity-25">
          <ChevronRight size={18} />
        </button>
      </div>

      <article
        key={`${note.id}:${fullDocument ? "full" : current.anchor}`}
        aria-label={fullDocument ? `${note.title}, full document` : `${note.title}, page ${index + 1}`}
        onPointerDown={(event) => { if (!fullDocument) swipe.current = { x: event.clientX, y: event.clientY }; }}
        onPointerUp={(event) => {
          const start = swipe.current;
          swipe.current = null;
          if (!start || fullDocument) return;
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
            <span className="flex items-center gap-1"><FileText size={11} />File</span>
            {study && <span className="flex items-center gap-1 rounded-full border border-[#bb8cff]/35 bg-[#bb8cff]/10 px-2 py-0.5 text-[#d9c2ff]"><GraduationCap size={11} />Study</span>}
          </div>
          <h2 className="text-xl font-semibold leading-snug text-white sm:text-2xl">{note.title}</h2>
          {!fullDocument && total > 1 && <p className="mt-1 text-xs text-white/40">{current.title}</p>}
          <p className="mt-2 flex items-center gap-1.5 text-[10px] text-white/30"><Clock3 size={10} />Updated {shortDate(note.updatedAt)} · v{note.version}</p>
        </header>
        <AssistantMarkdown text={shownMarkdown} />
      </article>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onEdit(note)}><Pencil size={13} />Edit file</Button>
        <Button size="sm" variant="outline" disabled={busy} aria-expanded={moveOpen} onClick={() => setMoveOpen((open) => !open)}><FolderInput size={13} />Move file</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onAsk(note)}><MessageSquareText size={13} />Ask AVA about this file</Button>
        <Button size="sm" variant="ghost" aria-expanded={contentsOpen} onClick={() => setContentsOpen((open) => !open)}><List size={13} />Contents</Button>
        <Button size="sm" variant="ghost" aria-pressed={fullDocument} onClick={() => setFullDocument((value) => !value)}><Rows3 size={13} />{fullDocument ? "Show pages" : "Show as one page"}</Button>
        {busy && <LoaderCircle size={14} className="animate-spin text-white/40" />}
      </div>

      {moveOpen && (
        <label className="mt-3 flex flex-col gap-1.5 rounded-xl border border-white/[0.08] bg-black/30 px-4 py-3 text-xs text-white/50 sm:flex-row sm:items-center">
          <span className="shrink-0">Move this file to</span>
          <select aria-label="Destination folder" value={noteFolderId(note)} onChange={(event) => { setMoveOpen(false); if (event.target.value !== noteFolderId(note)) onMove(note, event.target.value); }}
            className="h-9 min-w-0 flex-1 rounded-lg border border-white/10 bg-[#080a0b] px-3 text-sm text-white outline-none focus:border-[var(--ac)]/35">
            {folders.map(({ folder, depth }) => <option key={folder.id} value={folder.id}>{`${"  ".repeat(depth)}${folder.name}`}</option>)}
          </select>
        </label>
      )}

      {contentsOpen && (
        <nav aria-label="Document contents" className="mt-3 rounded-xl border border-white/[0.08] bg-black/30 px-3 py-3">
          <ol className="space-y-0.5">
            {pages.map((page, at) => (
              <li key={page.anchor}>
                <button type="button" aria-current={!fullDocument && at === index ? "page" : undefined}
                  onClick={() => { setFullDocument(false); go(at); setContentsOpen(false); }}
                  className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-xs transition motion-reduce:transition-none ${!fullDocument && at === index ? "bg-[var(--ac)]/[0.08] text-white" : "text-white/55 hover:bg-white/[0.04] hover:text-white"}`}>
                  <span className="hud w-6 shrink-0 text-right text-[10px] text-white/30">{at + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{page.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
      )}
    </section>
  );
}
