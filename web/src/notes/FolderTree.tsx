import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen, FolderPlus, Inbox, LoaderCircle, Pencil, Trash2 } from "lucide-react";
import { Button } from "./NotesPrimitives.js";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog.js";
import { GENERAL_FOLDER_ID, type NoteFolder } from "./api.js";
import { flattenFolderTree, type FolderNode } from "./folders.js";

/** Desktop: nested folder list. Phone: one folder menu. Both select the same folder. */
export function FolderTree({ tree, selectedId, onSelect, onNewFolder, onRename, onDelete, busy }: {
  tree: FolderNode[];
  selectedId: string;
  onSelect: (id: string) => void;
  onNewFolder: () => void;
  onRename: (folder: NoteFolder) => void;
  onDelete: (folder: NoteFolder) => void;
  busy: boolean;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const flat = flattenFolderTree(tree);
  const selected = flat.find((node) => node.folder.id === selectedId) ?? null;
  const deletable = !!selected && !selected.folder.builtIn && selected.folder.documentCount === 0 && selected.children.length === 0;

  const toggle = (id: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const renderNode = (node: FolderNode) => {
    const { folder } = node;
    const active = folder.id === selectedId;
    const open = !collapsed.has(folder.id);
    const Icon = folder.id === GENERAL_FOLDER_ID ? Inbox : active ? FolderOpen : Folder;
    return (
      <li key={folder.id}>
        <div className="flex items-center" style={{ paddingLeft: `${node.depth * 14}px` }}>
          {node.children.length > 0 ? (
            <button type="button" aria-label={`${open ? "Collapse" : "Expand"} ${folder.name}`} aria-expanded={open} onClick={() => toggle(folder.id)} className="flex h-7 w-5 shrink-0 items-center justify-center text-ink-2 hover:text-ink-2">
              {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          ) : <span className="w-5 shrink-0" />}
          <button
            type="button"
            aria-current={active ? "true" : undefined}
            onClick={() => onSelect(folder.id)}
            className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition ${active ? "border-glass-strong bg-glass-strong text-ink" : "border-transparent text-ink-2 hover:bg-glass hover:text-ink-2"}`}
          >
            <Icon size={13} className={active ? "shrink-0 text-ink" : "shrink-0"} />
            <span className="min-w-0 flex-1 truncate text-xs font-medium">{folder.name}</span>
            <span className="hud text-meta text-ink-2">{folder.documentCount}</span>
          </button>
        </div>
        {open && node.children.length > 0 && <ul>{node.children.map(renderNode)}</ul>}
      </li>
    );
  };

  const actions = (
    <div className="flex items-center gap-1">
      <button type="button" aria-label="New folder" disabled={busy} onClick={onNewFolder} className="rounded-md border border-glass-strong p-1.5 text-ink-2 transition hover:border-glass-strong hover:text-ink disabled:opacity-30"><FolderPlus size={14} /></button>
      <button type="button" aria-label="Rename folder" disabled={busy || !selected || selected.folder.builtIn} onClick={() => selected && onRename(selected.folder)} className="rounded-md border border-glass-strong p-1.5 text-ink-2 transition hover:text-ink disabled:opacity-30"><Pencil size={14} /></button>
      <button type="button" aria-label="Delete empty folder" title={deletable ? "Delete this empty folder" : "Only an empty folder can be deleted"} disabled={busy || !deletable} onClick={() => selected && onDelete(selected.folder)} className="rounded-md border border-glass-strong p-1.5 text-ink-2 transition hover:text-danger disabled:opacity-30"><Trash2 size={14} /></button>
    </div>
  );

  return (
    <>
      <div className="ds-notes-folder-select hidden items-center gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Folder</span>
          <select
            aria-label="Folder"
            value={selectedId}
            onChange={(event) => onSelect(event.target.value)}
            className="h-10 w-full rounded-lg border border-glass-strong bg-canvas px-3 text-sm text-ink ds-focus focus:border-glass-strong"
          >
            {flat.map(({ folder, depth }) => (
              <option key={folder.id} value={folder.id}>{`${"  ".repeat(depth)}${folder.name} (${folder.documentCount})`}</option>
            ))}
          </select>
        </label>
        {actions}
      </div>
      <nav aria-label="Folders" className="ds-note-folder-tree">
        <header className="mb-5 flex items-center justify-between pb-3">
          <span className="hud text-meta tracking-[0.18em] text-ink-2">FOLDERS</span>
          {actions}
        </header>
        <ul className="space-y-0.5">{tree.map(renderNode)}</ul>
      </nav>
    </>
  );
}

/** Create a folder inside the chosen parent, or rename an existing one. */
export function FolderDialog({ open, mode, parentName, initialName, busy, error, onOpenChange, onSubmit }: {
  open: boolean;
  mode: "create" | "rename";
  parentName: string | null;
  initialName: string;
  busy: boolean;
  error?: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string, topLevel: boolean) => Promise<void>;
}) {
  const [name, setName] = useState(initialName);
  const [topLevel, setTopLevel] = useState(false);
  useEffect(() => { if (open) { setName(initialName); setTopLevel(false); } }, [open, initialName]);
  const clean = name.trim();
  const invalid = !clean || clean.length > 80 || clean.includes("/");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="ds-root ds-notes-editor max-w-md border-0 bg-canvas">
        <div>
          <DialogTitle className="mb-2 flex items-center gap-2 text-sm font-semibold"><FolderPlus size={16} className="text-ink" />{mode === "create" ? "New folder" : "Rename folder"}</DialogTitle>
          <DialogDescription className="text-xs leading-5 text-ink-2">
            {mode === "create"
              ? parentName && !topLevel ? `It will sit inside ${parentName}.` : "It will sit at the top level."
              : "Files inside keep their order and history."}
          </DialogDescription>
        </div>
        {error && <p role="alert" className="text-body text-danger">{error}</p>}
        <label className="space-y-1.5 text-xs text-ink-2">
          <span>Name</span>
          <input
            autoFocus
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && !invalid && !busy) void onSubmit(clean, topLevel); }}
            className="h-10 w-full rounded-lg border border-glass-strong bg-transparent px-3 text-sm text-ink ds-focus focus:border-glass-strong"
            placeholder="e.g. Agile Development"
          />
        </label>
        {clean.includes("/") && <p className="text-meta text-ink-2">A folder name can't contain “/”.</p>}
        {mode === "create" && parentName && (
          <label className="flex items-center gap-2 text-xs text-ink-2">
            <input type="checkbox" checked={topLevel} onChange={(event) => setTopLevel(event.target.checked)} />
            Put it at the top level instead
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={invalid || busy} onClick={() => void onSubmit(clean, topLevel)}>
            {busy ? <LoaderCircle size={14} className="animate-spin" /> : <FolderPlus size={14} />}{mode === "create" ? "Create folder" : "Rename"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
