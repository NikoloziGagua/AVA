import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock3,
  FileText,
  GraduationCap,
  GripVertical,
  Inbox,
  KanbanSquare,
  Lightbulb,
  Link2,
  ListChecks,
  LoaderCircle,
  NotebookPen,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  Rocket,
  Scale,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { ApiError, fetchMemoryIndex, type MemoryIndexSearchResponse } from "../api.js";
import { OpenPlane as BorderGlow } from "./NotesPrimitives.js";
import { NotesShell as PanelShell } from "./NotesPrimitives.js";
import { Button } from "./NotesPrimitives.js";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog.js";
import {
  GENERAL_FOLDER_ID,
  NOTE_KINDS,
  NOTE_SECTIONS,
  NOTE_STAGES,
  createNote,
  createNoteFolder,
  deleteNote,
  deleteNoteFolder,
  fetchNotes,
  fetchNote,
  fetchNotesTree,
  promoteNote,
  updateNote,
  updateNoteFolder,
  type Note,
  type NoteDocumentType,
  type NoteFolder,
  type NoteKind,
  type NoteLink,
  type NoteSection,
  type NoteStage,
  type NotesSnapshot,
  type NotesTree,
} from "./api.js";
import { FolderDialog, FolderTree } from "./FolderTree.js";
import { NoteFileList } from "./NoteFileList.js";
import { NotePager } from "./NotePager.js";
import { ProjectBrief } from "./ProjectBrief.js";
import {
  STUDY_TEMPLATE,
  buildFolderTree,
  flattenFolderTree,
  folderLabel,
  folderDocuments,
  legacyFolders,
  matchesQuery,
  noteFolderId,
  type FolderNode,
} from "./folders.js";

const STAGE = {
  ideas: { label: "Ideas", icon: Lightbulb, color: "var(--ds-ink-2)", hint: "Captured and ready to shape" },
  doing: { label: "Doing", icon: Rocket, color: "var(--ds-ink-2)", hint: "Active work and next actions" },
  review: { label: "Review", icon: Search, color: "var(--ds-ink-2)", hint: "Validate, discuss or decide" },
  done: { label: "Done", icon: CheckCircle2, color: "var(--ds-ink-2)", hint: "Finished, retained as context" },
} as const;

const SECTION = {
  capture: { label: "Quick capture", icon: Inbox, description: "Ideas, requirements and useful fragments", color: "var(--ds-ink-2)" },
  priorities: { label: "Pinned priorities", icon: Pin, description: "What matters most right now", color: "var(--ds-ink-2)" },
  decisions: { label: "Decisions", icon: Scale, description: "What was chosen and why", color: "var(--ds-ink-2)" },
  documentation: { label: "Documentation", icon: BookOpen, description: "Stable context worth preserving", color: "var(--ds-ink-2)" },
} as const;

/** Browser-local only: whether Sir has dismissed the one-time folders notice. */
const MIGRATION_NOTICE_KEY = "ava:notes-folders-notice-v1";

type View = "files" | "board";
type EditorTarget = { note: Note | null; folderId: string; section: NoteSection; documentType: NoteDocumentType };
type FolderDialogState = { mode: "create"; parent: NoteFolder | null } | { mode: "rename"; folder: NoteFolder };
type EditorDraft = {
  title: string;
  content: string;
  kind: NoteKind;
  status: NoteStage;
  folderId: string;
  documentType: NoteDocumentType;
  section: NoteSection;
  tags: string[];
  links: NoteLink[];
  pinned: boolean;
};

function shortDate(at: number): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(at);
}

function defaultKind(section: NoteSection): NoteKind {
  if (section === "priorities") return "requirement";
  if (section === "decisions") return "decision";
  if (section === "documentation") return "documentation";
  return "idea";
}

function noticeDismissed(): boolean {
  try { return window.localStorage.getItem(MIGRATION_NOTICE_KEY) === "1"; } catch { return false; }
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div role="alert" className="flex items-start justify-between gap-4 rounded-xl border border-glass-strong bg-danger-soft px-4 py-3 text-xs text-danger">
      <span className="leading-5">{message}</span>
      <button type="button" onClick={onDismiss} className="hud text-meta tracking-[0.14em] text-danger hover:text-danger">DISMISS</button>
    </div>
  );
}

export function NotesScreen({ onStartTask, onOpenChat, initialNoteId = null }: {
  onStartTask: (prompt: string) => void;
  onOpenChat?: (sessionId: string) => void;
  /** Open exactly this note once, after the first successful load (from Today or Ideas). */
  initialNoteId?: string | null;
}) {
  const [snapshot, setSnapshot] = useState<NotesSnapshot | null>(null);
  const [partialSnapshot, setPartialSnapshot] = useState(false);
  const [tree, setTree] = useState<NotesTree | null>(null);
  // One-shot per navigation: consumed by the first successful snapshot, so the
  // periodic refresh can never re-open or re-select it.
  const pendingHandoff = useRef<string | null>(initialNoteId);
  const [selected, setSelected] = useState(GENERAL_FOLDER_ID);
  const [fileId, setFileIdState] = useState<string | null>(null);
  // The mount-time refresh callback must observe the current explicit selection.
  const currentFileId = useRef<string | null>(null);
  const setFileId = (id: string | null) => { currentFileId.current = id; setFileIdState(id); };
  const [view, setView] = useState<View>("files");
  const [phonePane, setPhonePane] = useState<"library" | "files" | "reader">("library");
  const [query, setQuery] = useState("");
  const [capture, setCapture] = useState("");
  const [captureSection, setCaptureSection] = useState<NoteSection>("capture");
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [folderDialog, setFolderDialog] = useState<FolderDialogState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [migrationSeen, setMigrationSeen] = useState(noticeDismissed);
  const [projectMemory, setProjectMemory] = useState<MemoryIndexSearchResponse | null>(null);
  const [projectMemoryLoading, setProjectMemoryLoading] = useState(false);
  const [projectMemoryError, setProjectMemoryError] = useState<string | null>(null);
  const projectMemoryRequest = useRef(0);
  const loadRequest = useRef(0);
  const mutation = useRef(false);

  const load = async (quiet = false) => {
    const request = ++loadRequest.current;
    const wanted = pendingHandoff.current ?? currentFileId.current;
    try {
      const [listed, nextTree] = await Promise.all([fetchNotes(), fetchNotesTree()]);
      let next = listed;
      if (request !== loadRequest.current) return;
      // The global snapshot is bounded. Absence there does not mean deletion.
      // Resolve only the exact requested/selected ID through its existing route.
      if (wanted && !next.notes.some((note) => note.id === wanted)) {
        try {
          const exact = await fetchNote(wanted);
          if (exact.id === wanted && exact.status !== "archived") next = { ...listed, notes: [...listed.notes, exact] };
        } catch (cause) {
          if (!(cause instanceof ApiError && cause.status === 404)) throw cause;
        }
      }
      if (request !== loadRequest.current || wanted !== (pendingHandoff.current ?? currentFileId.current)) return;
      setSnapshot(next);
      setPartialSnapshot(listed.notes.length >= 250 || !nextTree.snapshot.complete);
      setTree(nextTree);
      setSelected((current) => nextTree.folders.some((folder) => folder.id === current) ? current : GENERAL_FOLDER_ID);
      if (!quiet) setError(null);
      const handoff = pendingHandoff.current;
      if (handoff) {
        pendingHandoff.current = null;
        const target = next.notes.find((note) => note.id === handoff && note.status !== "archived");
        if (target) {
          setSelected(noteFolderId(target));
          setFileId(target.id);
          setView("files");
          setPhonePane("reader");
        } else {
          // Same wording whether it was deleted, archived or never existed.
          setSelected(GENERAL_FOLDER_ID);
          setNotice("That note is no longer available.");
        }
      } else if (wanted) {
        const target = next.notes.find((note) => note.id === wanted && note.status !== "archived");
        if (target) setSelected(noteFolderId(target));
        else { setFileId(null); setNotice("That note is no longer available."); }
      }
    } catch (cause) {
      if (request !== loadRequest.current || wanted !== (pendingHandoff.current ?? currentFileId.current)) return;
      if (!quiet) setError(cause instanceof Error ? cause.message : "Notes could not be loaded.");
      else if (wanted) setError(current => current ?? "The selected file could not be refreshed. Its contents may be out of date.");
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 10_000);
    const refresh = () => void load(true);
    window.addEventListener("focus", refresh);
    return () => { ++loadRequest.current; window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);

  const folderTree = useMemo<FolderNode[]>(() => buildFolderTree(tree?.folders ?? []), [tree]);
  const flatFolders = useMemo(() => flattenFolderTree(folderTree), [folderTree]);
  const folder = tree?.folders.find((entry) => entry.id === selected) ?? null;
  const folderName = folder?.name ?? "General";
  // Pre-folder project spaces kept their ids as folders, so the Board's brief still finds them.
  const project = snapshot?.projects.find((entry) => entry.id === selected) ?? null;

  const loadProjectMemory = async (projectName: string) => {
    const request = ++projectMemoryRequest.current;
    setProjectMemoryLoading(true);
    setProjectMemoryError(null);
    try {
      const result = await fetchMemoryIndex(projectName);
      if (request === projectMemoryRequest.current) setProjectMemory(result);
    }
    catch (cause) {
      if (request === projectMemoryRequest.current) {
        setProjectMemory(null);
        setProjectMemoryError(cause instanceof Error ? cause.message : "Indexed project knowledge could not be loaded.");
      }
    } finally {
      if (request === projectMemoryRequest.current) setProjectMemoryLoading(false);
    }
  };

  const briefProject = view === "board" ? project : null;
  useEffect(() => {
    if (!briefProject) {
      projectMemoryRequest.current += 1;
      setProjectMemory(null);
      setProjectMemoryError(null);
      setProjectMemoryLoading(false);
      return;
    }
    setProjectMemory(null);
    void loadProjectMemory(briefProject.name);
  }, [briefProject?.id, briefProject?.name]);

  const files = useMemo(() => snapshot ? folderDocuments(snapshot.notes, selected) : [], [snapshot, selected]);
  const partialFiles = partialSnapshot || (folder !== null && files.length !== folder.documentCount);
  const selectedFile = files.find((note) => note.id === fileId) ?? files[0] ?? null;
  const searchResults = useMemo(() => {
    if (!snapshot || !query.trim()) return [];
    return snapshot.notes.filter((note) => note.status !== "archived" && matchesQuery(note, query));
  }, [snapshot, query]);
  const boardNotes = useMemo(() => files.filter((note) => matchesQuery(note, query)), [files, query]);

  const selectFolder = (id: string) => {
    setSelected(id);
    setFileId(null);
    setPhonePane("files");
    setQuery("");
  };

  const openFile = (note: Note) => {
    setSelected(noteFolderId(note));
    setFileId(note.id);
    setView("files");
    setQuery("");
    setPhonePane("reader");
  };

  const perform = async (key: string, action: () => Promise<void>) => {
    if (mutation.current) return;
    mutation.current = true;
    setBusy(key);
    setError(null);
    try { await action(); await load(true); }
    catch (cause) {
      setError(cause instanceof ApiError && cause.code === "stale_version"
        ? key === "editor" ? "That changed in another window or through AVA. Close this editor and reopen the latest version before making your change."
          : "That changed in another window or through AVA. Refreshing the latest version; review it before making your change again."
        : cause instanceof Error ? cause.message : "The Notes action failed.");
      await load(true);
    } finally { mutation.current = false; setBusy(null); }
  };

  const quickCapture = async () => {
    const content = capture.trim();
    if (!content || !snapshot) return;
    await perform("capture", async () => {
      const created = await createNote({
        content,
        folderId: selected,
        section: captureSection,
        kind: defaultKind(captureSection),
        pinned: captureSection === "priorities",
      });
      setCapture("");
      setFileId(created.id);
      setNotice(`Captured as a new file in ${folderName}.`);
    });
  };

  const moveNote = async (note: Note, status: NoteStage) => {
    if (status === note.status || status === "archived") return;
    await perform(note.id, async () => { await updateNote(note.id, note.version, { status }); });
  };

  const togglePin = async (note: Note) => {
    await perform(note.id, async () => {
      await updateNote(note.id, note.version, {
        pinned: !note.pinned,
        ...(!note.pinned ? { section: "priorities" as const } : {}),
      });
    });
  };

  const moveFile = async (note: Note, folderId: string) => {
    const destination = tree?.folders.find((entry) => entry.id === folderId);
    const at = files.findIndex((file) => file.id === note.id);
    const neighbour = files[at + 1] ?? files[at - 1] ?? null;
    await perform("file", async () => {
      await updateNote(note.id, note.version, { folderId });
      setFileId(neighbour?.id ?? null);
      setNotice(`Moved “${note.title}” to ${destination ? folderLabel(destination) : "another folder"}. It is the last file there.`);
    });
  };

  const newFile = (documentType: NoteDocumentType = "general") =>
    setEditor({ note: null, folderId: selected, section: "capture", documentType });

  const legacy = tree ? legacyFolders(tree.folders, tree.migration.legacyRootFolderIds) : [];
  const showMigration = !!tree && !migrationSeen && tree.migration.legacyProjectCount > 0;
  const dismissMigration = () => {
    setMigrationSeen(true);
    try { window.localStorage.setItem(MIGRATION_NOTICE_KEY, "1"); } catch { /* per-browser convenience only */ }
  };

  if (!snapshot && !error) {
    return (
      <PanelShell title="Notes">
        <div className="flex h-64 items-center justify-center text-ink-2"><LoaderCircle className="mr-3 animate-spin" size={18} />Opening your workspace…</div>
      </PanelShell>
    );
  }

  if (!snapshot || !tree) {
    return <PanelShell title="Notes"><div className="mx-auto max-w-xl"><ErrorBanner message={error ?? "Notes could not be loaded."} onDismiss={() => void load()} /></div></PanelShell>;
  }

  const pinned = boardNotes.filter((note) => note.pinned);
  const crumbs = folder ? folderLabel(folder) : "General";

  return (
    <PanelShell title="Notes" grid pane={phonePane}>
      <div className="ds-notes-phone-path ds-notes-wide">
        {phonePane !== "library" && <button className="ds-focus ds-notes-button ds-notes-button-ghost" onClick={() => {
          setPhonePane(phonePane === "reader" ? "files" : "library");
          requestAnimationFrame(() => document.querySelector<HTMLElement>(phonePane === "reader" ? '.ds-note-files button[aria-current="page"]' : '.ds-notes-folders button[aria-current="true"]')?.focus());
        }}><ArrowLeft size={16} aria-hidden />{phonePane === "reader" ? "Back to files" : "Back to library"}</button>}
        <span>{phonePane === "library" ? "Library" : phonePane === "files" ? folderName : selectedFile?.title ?? folderName}</span>
      </div>
      <section className="ds-notes-wide ds-notes-capture" data-panel-section>
        <BorderGlow className="overflow-hidden px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex items-center gap-2">
                <NotebookPen size={15} className="text-ink" />
                <span className="hud text-meta tracking-[0.18em] text-ink-2">QUICK CAPTURE · {folderName.toUpperCase()}</span>
              </div>
              <textarea
                value={capture}
                onChange={(event) => setCapture(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void quickCapture(); }
                }}
                placeholder="Drop the thought here. AVA can organise it with you later…"
                className="min-h-16 w-full resize-none rounded-xl border border-glass-strong bg-transparent px-4 py-3 text-sm leading-6 text-ink ds-focus transition focus:border-glass-strong focus:ring-2 focus:ring-glass-strong"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {NOTE_SECTIONS.map((section) => {
                const meta = SECTION[section];
                const Icon = meta.icon;
                const active = captureSection === section;
                return (
                  <button key={section} type="button" aria-pressed={active} onClick={() => setCaptureSection(section)}
                    className={`hidden h-9 sm:flex items-center gap-2 rounded-lg border px-3 text-meta transition ${active ? "border-glass-strong bg-glass text-ink" : "border-glass-strong bg-transparent text-ink-2 hover:text-ink-2"}`}>
                    <Icon size={13} style={{ color: active ? meta.color : undefined }} />{meta.label}
                  </button>
                );
              })}
              <Button size="sm" disabled={!capture.trim() || busy === "capture"} onClick={() => void quickCapture()} className="h-9 bg-glass-strong text-ink hover:bg-canvas">
                {busy === "capture" ? <LoaderCircle size={14} className="animate-spin" /> : <Plus size={14} />}Capture
              </Button>
            </div>
          </div>
          <div className="mt-2 hidden items-center justify-between gap-3 text-meta text-ink-2 sm:flex">
            <span>Tip: tell AVA “add this to my Agile Development study notes.”</span>
            <span className="hidden sm:block">Ctrl + Enter to capture</span>
          </div>
        </BorderGlow>
      </section>

      {showMigration && (
        <section aria-label="Notes now use folders" className="ds-notes-wide" data-panel-section>
          <div className="rounded-xl border border-glass-strong bg-glass-strong px-4 py-3 text-xs leading-5 text-ink-2">
            <p className="font-medium text-ink">Notes now live as files inside folders.</p>
            <p className="mt-1">
              All {tree.snapshot.totalDocuments} of your notes are here unchanged, in the order they were written.
              Your old project spaces became folders. Nothing was merged or renamed.
            </p>
            {legacy.length > 0 && (
              <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Folders made from project spaces">
                {legacy.map((entry) => (
                  <li key={entry.id} className="rounded-md border border-glass-strong bg-transparent px-2 py-0.5 text-meta text-ink-2">{folderLabel(entry)} · {entry.documentCount}</li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-ink-2">If two folders belong together, move the files yourself or ask AVA to combine them. She will show you first.</p>
            <button type="button" onClick={dismissMigration} className="hud mt-2 text-meta tracking-[0.14em] text-ink hover:text-ink">GOT IT</button>
          </div>
        </section>
      )}

      {(error || notice) && !editor && !folderDialog && (
        <div className="ds-notes-wide" data-panel-section>
          {error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : (
            <div role="status" className="flex items-start justify-between gap-4 rounded-xl border border-glass-strong bg-glass-strong px-4 py-3 text-xs text-ink-2">
              <span>{notice}</span>
              <button type="button" onClick={() => setNotice(null)} className="hud text-meta tracking-[0.14em] text-ink-2 hover:text-ink-2">DISMISS</button>
            </div>
          )}
        </div>
      )}

      <aside className="ds-notes-folders" data-panel-section>
        <BorderGlow className="px-3 py-3 sm:px-4 sm:py-4">
          <FolderTree
            tree={folderTree}
            selectedId={selected}
            busy={busy === "folder"}
            onSelect={selectFolder}
            onNewFolder={() => setFolderDialog({ mode: "create", parent: folder })}
            onRename={(target) => setFolderDialog({ mode: "rename", folder: target })}
            onDelete={(target) => {
              if (!window.confirm(`Delete the empty folder “${target.name}”?`)) return;
              void perform("folder", async () => {
                await deleteNoteFolder(target.id, target.version);
                selectFolder(target.parentId ?? GENERAL_FOLDER_ID);
                setNotice(`Deleted the empty folder “${target.name}”.`);
              });
            }}
          />
        </BorderGlow>
      </aside>

      <main className="min-w-0 ds-notes-main" data-panel-section>
        <div className="ds-notes-folder-heading">
          <div className="min-w-0">
            <p className="truncate text-meta text-ink-2">{crumbs}</p>
            <div className="flex items-center gap-2">
              <h2 className="truncate text-lg font-semibold text-ink">{folderName}</h2>
              <span className="rounded-full border border-glass-strong px-2 py-0.5 text-meta text-ink-2">{folder?.documentCount ?? files.length} {(folder?.documentCount ?? files.length) === 1 ? "file" : "files"}</span>
            </div>
            {folder?.description && <p className="mt-0.5 text-xs text-ink-2">{folder.description}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-0 basis-full sm:w-52 sm:basis-auto sm:flex-none">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-2" />
              <input
                aria-label={view === "files" ? "Search all files" : "Search this folder"}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={view === "files" ? "Search all files" : "Search this folder"}
                className="h-9 w-full rounded-lg border border-glass-strong bg-transparent pl-9 pr-3 text-xs text-ink ds-focus focus:border-glass-strong"
              />
            </label>
            <div role="group" aria-label="View" className="flex rounded-lg border border-glass-strong p-0.5">
              <button type="button" aria-pressed={view === "files"} onClick={() => setView("files")} className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-meta ${view === "files" ? "bg-glass text-ink" : "text-ink-2 hover:text-ink-2"}`}><BookOpen size={13} />Files</button>
              <button type="button" aria-pressed={view === "board"} onClick={() => setView("board")} className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-meta ${view === "board" ? "bg-glass text-ink" : "text-ink-2 hover:text-ink-2"}`}><KanbanSquare size={13} />Board</button>
            </div>
            <button type="button" aria-label="Refresh notes" onClick={() => void load()} className="flex h-9 w-9 items-center justify-center rounded-lg border border-glass-strong text-ink-2 transition hover:text-ink"><RefreshCw size={14} /></button>
            <Button size="sm" onClick={() => newFile()} className="h-9"><Plus size={14} />New file</Button>
            <Button size="sm" variant="outline" onClick={() => newFile("study")} className="h-9"><GraduationCap size={14} />Study file</Button>
          </div>
        </div>

        {view === "files" && query.trim() ? (
          <section aria-label="Search results" className="rounded-2xl border border-glass-strong bg-transparent px-3 py-3">
            {partialSnapshot && <p className="px-2 text-meta text-ink-2">Searching loaded files only; other files may not be included.</p>}
            <p className="mb-2 px-2 text-meta text-ink-2">{searchResults.length} {searchResults.length === 1 ? "file matches" : "files match"} “{query.trim()}”</p>
            <ul className="space-y-0.5">
              {searchResults.map((note) => (
                <li key={note.id}>
                  <button type="button" onClick={() => openFile(note)} className="flex w-full flex-col rounded-lg px-3 py-2 text-left transition hover:bg-glass">
                    <span className="text-sm text-ink-2">{note.title}</span>
                    <span className="text-meta text-ink-2">{note.folderPath?.map((crumb) => crumb.name).join(" / ") || "General"}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : view === "files" ? (
          <div className="ds-notes-files-reader">
            <NoteFileList
              files={files}
              selectedId={selectedFile?.id ?? null}
              folderName={folderName}
              partial={partialFiles}
              onSelect={(id) => { setFileId(id); setPhonePane("reader"); }}
              onNewFile={() => newFile()}
            />
            <NotePager
              note={selectedFile}
              folderName={folderName}
              folders={flatFolders}
              busy={busy === "file"}
              onEdit={(note) => setEditor({ note, folderId: noteFolderId(note), section: note.section, documentType: note.documentType ?? "general" })}
              onMove={(note, folderId) => void moveFile(note, folderId)}
              onAsk={(note) => onStartTask(`Open my Notes file “${note.title}” (stable ID: ${note.id}; folder: ${note.folderPath?.map((crumb) => crumb.name).join(" / ") || "General"}) and help me work through it.`)}
              onNewFile={() => newFile()}
            />
          </div>
        ) : (
          <>
            {project && (
              <ProjectBrief
                project={project}
                notes={files}
                memory={projectMemory}
                memoryLoading={projectMemoryLoading}
                memoryError={projectMemoryError}
                onRetryMemory={() => void loadProjectMemory(project.name)}
                onOpenNote={openFile}
                onOpenChat={onOpenChat}
              />
            )}

            {pinned.length > 0 && (
              <div className="mb-5 rounded-xl border border-glass-strong bg-canvas px-4 py-3">
                <div className="mb-2 flex items-center gap-2 hud text-meta tracking-[0.16em] text-ink-2"><Pin size={12} />PINNED PRIORITIES</div>
                <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                  {pinned.map((note) => (
                    <button key={note.id} type="button" onClick={() => openFile(note)}
                      className="min-w-52 max-w-72 rounded-lg border border-glass-strong bg-transparent px-3 py-2 text-left text-xs text-ink-2 hover:border-glass-strong hover:text-ink">
                      <span className="line-clamp-1 font-medium">{note.title}</span>
                      <span className="mt-1 block line-clamp-1 text-meta text-ink-2">{note.content}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="no-scrollbar overflow-x-auto pb-4">
              <div className="grid min-w-[980px] grid-cols-4 gap-3 lg:min-w-0">
                {NOTE_STAGES.map((stage) => {
                  const meta = STAGE[stage];
                  const Icon = meta.icon;
                  const notes = boardNotes.filter((note) => note.status === stage);
                  return (
                    <section key={stage} className="min-h-[360px] rounded-2xl border border-glass-strong bg-glass p-3"
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        const note = snapshot.notes.find((entry) => entry.id === event.dataTransfer.getData("text/note-id"));
                        if (note) void moveNote(note, stage);
                      }}>
                      <header className="mb-3 rounded-xl border border-glass-strong bg-transparent px-3 py-3">
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-2 text-xs font-semibold text-ink-2"><Icon size={14} style={{ color: meta.color }} />{meta.label}</span>
                          <span className="hud rounded-full border border-glass-strong px-2 py-0.5 text-meta text-ink-2">{notes.length}</span>
                        </div>
                        <p className="mt-1.5 text-meta text-ink-2">{meta.hint}</p>
                      </header>
                      <div className="space-y-2.5">
                        {notes.map((note) => (
                          <NoteCard key={note.id} note={note} busy={busy === note.id}
                            onOpen={() => setEditor({ note, folderId: noteFolderId(note), section: note.section, documentType: note.documentType ?? "general" })}
                            onMove={(direction) => {
                              const at = NOTE_STAGES.indexOf(note.status as typeof NOTE_STAGES[number]);
                              const next = NOTE_STAGES[at + direction];
                              if (next) void moveNote(note, next);
                            }}
                            onPin={() => void togglePin(note)} />
                        ))}
                        {notes.length === 0 && (
                          <button type="button" onClick={() => newFile()}
                            className="flex min-h-24 w-full flex-col items-center justify-center rounded-xl border border-dashed border-glass-strong text-meta text-ink-2 transition hover:border-glass-strong hover:text-ink-2">
                            <Plus size={15} className="mb-2" />Add to {meta.label}
                          </button>
                        )}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </main>

      <FolderDialog
        open={!!folderDialog}
        mode={folderDialog?.mode ?? "create"}
        parentName={folderDialog?.mode === "create" ? folderDialog.parent?.name ?? null : null}
        initialName={folderDialog?.mode === "rename" ? folderDialog.folder.name : ""}
        busy={busy === "folder"}
        error={error}
        onOpenChange={(open) => { if (!open && !busy) setFolderDialog(null); }}
        onSubmit={async (name, topLevel) => {
          const state = folderDialog;
          if (!state) return;
          await perform("folder", async () => {
            if (state.mode === "create") {
              const created = await createNoteFolder({ parentId: topLevel ? null : state.parent?.id ?? null, name });
              selectFolder(created.id);
              setNotice(`Created the folder “${created.name}”.`);
            } else {
              const renamed = await updateNoteFolder(state.folder.id, state.folder.version, { name });
              setNotice(`Renamed the folder to “${renamed.name}”.`);
            }
            setFolderDialog(null);
          });
        }}
      />

      <NoteEditor open={!!editor} target={editor} folders={flatFolders} busy={busy === "editor"} error={error} onOpenChange={(open) => { if (!open && !busy) setEditor(null); }}
        onSave={async (draft) => {
          const current = editor?.note ?? null;
          await perform("editor", async () => {
            if (current) {
              const { folderId, documentType, ...rest } = draft;
              await updateNote(current.id, current.version, {
                ...rest,
                ...(folderId !== noteFolderId(current) ? { folderId } : {}),
                ...(documentType !== (current.documentType ?? "general") ? { documentType } : {}),
              });
              if (folderId !== noteFolderId(current)) { setSelected(folderId); setFileId(current.id); }
            } else {
              const created = await createNote(draft);
              setSelected(noteFolderId(created));
              setFileId(created.id);
              setView("files");
              setPhonePane("reader");
            }
            setEditor(null);
            setNotice(current ? "File updated with a new change-history entry." : "New file added at the end of the folder.");
          });
        }}
        onDelete={editor?.note ? async () => {
          if (!window.confirm("Delete this file permanently?")) return;
          await perform("editor", async () => { await deleteNote(editor.note!.id, editor.note!.version); setEditor(null); });
        } : undefined}
        onPromote={editor?.note ? async (target) => {
          await perform("editor", async () => {
            const result = await promoteNote(editor.note!.id, editor.note!.version, target);
            setEditor(null);
            if (target === "task" && result.prompt) onStartTask(result.prompt);
            else setNotice(`Self-improvement ${result.promotionId} is queued for AVA's normal plan approval.`);
          });
        } : undefined} />
    </PanelShell>
  );
}

function NoteCard({ note, busy, onOpen, onMove, onPin }: {
  note: Note;
  busy: boolean;
  onOpen: () => void;
  onMove: (direction: -1 | 1) => void;
  onPin: () => void;
}) {
  const section = SECTION[note.section];
  const SectionIcon = section.icon;
  const stageIndex = NOTE_STAGES.indexOf(note.status as typeof NOTE_STAGES[number]);
  return (
    <article draggable onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/note-id", note.id); }}
      className="group rounded-xl border border-glass-strong bg-transparent px-3.5 py-3 shadow-none transition hover:-translate-y-0.5 hover:border-glass-strong hover:bg-transparent">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-meta uppercase tracking-[0.12em] text-ink-2"><GripVertical size={11} className="cursor-grab" /><SectionIcon size={11} style={{ color: section.color }} />{note.kind}</span>
        <button type="button" aria-label={note.pinned ? "Unpin note" : "Pin note"} aria-pressed={note.pinned} onClick={onPin} className={note.pinned ? "text-ink" : "text-ink-2 hover:text-ink"}><Pin size={12} fill={note.pinned ? "currentColor" : "none"} /></button>
      </div>
      <button type="button" onClick={onOpen} className="block w-full text-left">
        <h3 className="line-clamp-2 text-[13px] font-semibold leading-5 text-ink">{note.title}</h3>
        <p className="mt-1.5 line-clamp-3 whitespace-pre-wrap text-meta leading-4 text-ink-2">{note.content}</p>
      </button>
      {note.tags.length > 0 && <div className="mt-2.5 flex flex-wrap gap-1">{note.tags.slice(0, 3).map((tag) => <span key={tag} className="rounded bg-glass px-1.5 py-0.5 text-meta text-ink-2">#{tag}</span>)}</div>}
      <div className="mt-3 flex items-center justify-between border-t border-glass-strong pt-2.5">
        <span className="flex items-center gap-2 text-meta text-ink-2">
          <Clock3 size={10} />{shortDate(note.updatedAt)}
          {note.links.length > 0 && <span className="flex items-center gap-1"><Link2 size={9} />{note.links.length}</span>}
          {note.promotion && <span className="text-ink-2">PROMOTED</span>}
        </span>
        <span className="flex items-center gap-1">
          <button type="button" aria-label="Move note left" disabled={busy || stageIndex <= 0} onClick={onMove.bind(null, -1)} className="rounded p-1 text-ink-2 hover:bg-glass hover:text-ink disabled:opacity-15"><ArrowLeft size={11} /></button>
          <button type="button" aria-label="Edit note" onClick={onOpen} className="rounded p-1 text-ink-2 hover:bg-glass hover:text-ink"><Pencil size={11} /></button>
          <button type="button" aria-label="Move note right" disabled={busy || stageIndex >= NOTE_STAGES.length - 1} onClick={onMove.bind(null, 1)} className="rounded p-1 text-ink-2 hover:bg-glass hover:text-ink disabled:opacity-15">{busy ? <LoaderCircle size={11} className="animate-spin" /> : <ArrowRight size={11} />}</button>
        </span>
      </div>
    </article>
  );
}

function linksFromText(text: string): NoteLink[] {
  return text.split(/\r?\n/).flatMap((line) => {
    const clean = line.trim();
    if (!clean) return [];
    const divider = clean.indexOf("|");
    return divider >= 0
      ? [{ label: clean.slice(0, divider).trim(), url: clean.slice(divider + 1).trim() }]
      : [{ label: "", url: clean }];
  });
}

function NoteEditor({ open, target, folders, busy, error, onOpenChange, onSave, onDelete, onPromote }: {
  open: boolean;
  target: EditorTarget | null;
  folders: FolderNode[];
  busy: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onSave: (draft: EditorDraft) => Promise<void>;
  onDelete?: () => Promise<void>;
  onPromote?: (target: "task" | "self_improvement") => Promise<void>;
}) {
  const note = target?.note ?? null;
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<NoteKind>("idea");
  const [status, setStatus] = useState<NoteStage>("ideas");
  const [folderId, setFolderId] = useState(GENERAL_FOLDER_ID);
  const [documentType, setDocumentType] = useState<NoteDocumentType>("general");
  const [section, setSection] = useState<NoteSection>("capture");
  const [tags, setTags] = useState("");
  const [linkText, setLinkText] = useState("");
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    if (!target) return;
    const type = note?.documentType ?? target.documentType;
    setTitle(note?.title ?? "");
    setContent(note?.content ?? (type === "study" ? STUDY_TEMPLATE : ""));
    setKind(note?.kind ?? defaultKind(target.section));
    setStatus(note?.status ?? "ideas");
    setFolderId(note ? noteFolderId(note) : target.folderId);
    setDocumentType(type);
    setSection(note?.section ?? target.section);
    setTags(note?.tags.join(", ") ?? "");
    setLinkText(note?.links.map((link) => `${link.label} | ${link.url}`).join("\n") ?? "");
    setPinned(note?.pinned ?? target.section === "priorities");
  }, [target?.note?.id, target?.note?.version, target?.folderId, target?.section, target?.documentType]);

  const changeType = (next: NoteDocumentType) => {
    setDocumentType(next);
    // Only a blank file gets the study headings; existing writing is never replaced.
    if (next === "study" && !content.trim()) setContent(STUDY_TEMPLATE);
    if (next === "general" && content === STUDY_TEMPLATE) setContent("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="ds-root ds-notes-editor max-h-[88vh] max-w-3xl overflow-y-auto border-0 bg-canvas p-0">
        <div className="sticky top-0 z-10 border-b border-glass-strong bg-canvas px-6 py-5 ">
          <div className="flex items-center gap-2"><FileText size={16} className="text-ink" /><DialogTitle className="text-sm font-semibold">{note ? "Edit file" : documentType === "study" ? "New study file" : "New file"}</DialogTitle>{note && <span className="hud text-meta text-ink-2">V{note.version}</span>}</div>
          <DialogDescription className="mt-1 text-meta text-ink-2">Context, references and every meaningful change stay together.</DialogDescription>
        </div>
        <div className="grid gap-5 px-6 py-5 md:grid-cols-2">
          {error && <p role="alert" className="md:col-span-2 text-body text-danger">{error}</p>}
          <label className="space-y-1.5 text-xs text-ink-2 md:col-span-2"><span>Title</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} className="h-10 w-full rounded-lg border border-glass-strong bg-transparent px-3 text-sm text-ink ds-focus focus:border-glass-strong" placeholder={documentType === "study" ? "e.g. Lecture 4: Scrum roles" : "A clear, useful title"} /></label>
          <label className="space-y-1.5 text-xs text-ink-2 md:col-span-2"><span>Document</span><textarea value={content} onChange={(event) => setContent(event.target.value)} className="min-h-56 w-full resize-y rounded-lg border border-glass-strong bg-transparent px-3 py-3 text-sm leading-6 text-ink ds-focus focus:border-glass-strong" placeholder="Write the file. Markdown headings and lists work." /></label>
          <details className="md:col-span-2"><summary className="ds-focus cursor-pointer py-3 text-meta text-ink-2">Details · folder, type, tags and history</summary>
          <div className="grid gap-5 pt-3 md:grid-cols-2">
          <FieldSelect label="Folder" value={folderId} onChange={setFolderId} options={folders.map(({ folder, depth }) => ({ value: folder.id, label: `${"  ".repeat(depth)}${folder.name}` }))} />
          <FieldSelect label="File type" value={documentType} onChange={(value) => changeType(value as NoteDocumentType)} options={[{ value: "general", label: "General file" }, { value: "study", label: "Study notes" }]} />
          <FieldSelect label="Template section" value={section} onChange={(value) => setSection(value as NoteSection)} options={NOTE_SECTIONS.map((value) => ({ value, label: SECTION[value].label }))} />
          <FieldSelect label="Kind" value={kind} onChange={(value) => setKind(value as NoteKind)} options={NOTE_KINDS.map((value) => ({ value, label: value.replace("_", " ") }))} />
          <FieldSelect label="Board stage" value={status} onChange={(value) => setStatus(value as NoteStage)} options={NOTE_STAGES.map((value) => ({ value, label: STAGE[value].label }))} />
          <label className="space-y-1.5 text-xs text-ink-2"><span>Tags</span><input value={tags} onChange={(event) => setTags(event.target.value)} className="h-10 w-full rounded-lg border border-glass-strong bg-transparent px-3 text-sm text-ink ds-focus focus:border-glass-strong" placeholder="voice, reliability, UX" /></label>
          <label className="flex items-end md:col-span-2">
            <button
              type="button"
              aria-pressed={pinned}
              onClick={() => {
                setPinned((value) => !value);
                if (!pinned) setSection("priorities");
              }}
              className={
                "flex min-h-11 items-center gap-2 rounded-button px-2 text-meta transition " +
                (pinned
                  ? "border-glass-strong bg-canvas text-ink-2"
                  : "border-glass-strong bg-transparent text-ink-2 hover:text-ink-2")
              }
            >
              <Pin size={13} fill={pinned ? "currentColor" : "none"} />
              {pinned ? "Pinned priority" : "Pin as priority"}
            </button>
          </label>
          <label className="space-y-1.5 text-xs text-ink-2 md:col-span-2"><span>Links · one per line as Label | URL</span><textarea value={linkText} onChange={(event) => setLinkText(event.target.value)} className="min-h-20 w-full resize-y rounded-lg border border-glass-strong bg-transparent px-3 py-2 font-mono text-meta leading-5 text-ink ds-focus focus:border-glass-strong" placeholder="Design | https://…" /></label>

          {note && note.changeLog.length > 0 && (
            <section className="ds-note-history md:col-span-2 px-1 py-4">
              <div className="mb-3 flex items-center gap-2 hud text-meta tracking-[0.15em] text-ink-2"><Clock3 size={12} />CHANGE HISTORY</div>
              <div className="space-y-2">{note.changeLog.slice().reverse().slice(0, 8).map((entry) => <div key={entry.id} className="flex gap-3 text-meta"><span className="w-28 shrink-0 text-ink-2">{shortDate(entry.at)}</span><span className="w-16 shrink-0 uppercase text-ink">{entry.action}</span><span className="text-ink-2">{entry.detail}</span></div>)}</div>
            </section>
          )}
          </div></details>
        </div>
        <footer className="sticky bottom-0 flex flex-col gap-3 border-t border-glass-strong bg-canvas px-6 py-4  sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {note && onPromote && <><Button size="sm" variant="outline" disabled={busy} onClick={() => void onPromote("task")}><ListChecks size={13} />Start task</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void onPromote("self_improvement")}><Sparkles size={13} />Self-improvement</Button></>}
            {note?.promotion && <span className="flex items-center gap-1.5 text-meta text-ink-2"><CheckCircle2 size={11} />Promoted to {note.promotion.type.replace("_", " ")}</span>}
          </div>
          <div className="flex items-center justify-end gap-2">
            {onDelete && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onDelete()} className="text-danger hover:text-danger"><Trash2 size={13} />Delete</Button>}
            <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" disabled={!content.trim() || busy} onClick={() => void onSave({ title, content, kind, status, folderId, documentType, section, tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean), links: linksFromText(linkText), pinned })}>{busy ? <LoaderCircle size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}Save file</Button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function FieldSelect({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return <label className="space-y-1.5 text-xs text-ink-2"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-full rounded-lg border border-glass-strong bg-canvas px-3 text-sm text-ink ds-focus focus:border-glass-strong">{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}
