import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen, FolderPlus, Inbox, LoaderCircle, Pencil, Trash2 } from "lucide-react";
import { Button } from "../components/ui/button.js";
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
            <button type="button" aria-label={`${open ? "Collapse" : "Expand"} ${folder.name}`} aria-expanded={open} onClick={() => toggle(folder.id)} className="flex h-7 w-5 shrink-0 items-center justify-center text-white/30 hover:text-white/70">
              {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
          ) : <span className="w-5 shrink-0" />}
          <button
            type="button"
            aria-current={active ? "true" : undefined}
            onClick={() => onSelect(folder.id)}
            className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition ${active ? "border-[var(--ac)]/25 bg-[var(--ac)]/[0.08] text-white" : "border-transparent text-white/50 hover:bg-white/[0.03] hover:text-white/80"}`}
          >
            <Icon size={13} className={active ? "shrink-0 text-[var(--ac)]" : "shrink-0"} />
            <span className="min-w-0 flex-1 truncate text-xs font-medium">{folder.name}</span>
            <span className="hud text-[9px] text-white/30">{folder.documentCount}</span>
          </button>
        </div>
        {open && node.children.length > 0 && <ul>{node.children.map(renderNode)}</ul>}
      </li>
    );
  };

  const actions = (
    <div className="flex items-center gap-1">
      <button type="button" aria-label="New folder" disabled={busy} onClick={onNewFolder} className="rounded-md border border-white/10 p-1.5 text-white/55 transition hover:border-[var(--ac)]/30 hover:text-[var(--ac)] disabled:opacity-30"><FolderPlus size={14} /></button>
      <button type="button" aria-label="Rename folder" disabled={busy || !selected || selected.folder.builtIn} onClick={() => selected && onRename(selected.folder)} className="rounded-md border border-white/10 p-1.5 text-white/55 transition hover:text-white disabled:opacity-30"><Pencil size={14} /></button>
      <button type="button" aria-label="Delete empty folder" title={deletable ? "Delete this empty folder" : "Only an empty folder can be deleted"} disabled={busy || !deletable} onClick={() => selected && onDelete(selected.folder)} className="rounded-md border border-white/10 p-1.5 text-white/55 transition hover:text-red-200 disabled:opacity-30"><Trash2 size={14} /></button>
    </div>
  );

  return (
    <>
      <div className="flex items-center gap-2 lg:hidden">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Folder</span>
          <select
            aria-label="Folder"
            value={selectedId}
            onChange={(event) => onSelect(event.target.value)}
            className="h-10 w-full rounded-lg border border-white/10 bg-[#080a0b] px-3 text-sm text-white outline-none focus:border-[var(--ac)]/35"
          >
            {flat.map(({ folder, depth }) => (
              <option key={folder.id} value={folder.id}>{`${"  ".repeat(depth)}${folder.name} (${folder.documentCount})`}</option>
            ))}
          </select>
        </label>
        {actions}
      </div>
      <nav aria-label="Folders" className="hidden lg:block">
        <header className="mb-3 flex items-center justify-between border-b border-white/[0.07] pb-3">
          <span className="hud text-[10px] tracking-[0.18em] text-white/55">FOLDERS</span>
          {actions}
        </header>
        <ul className="space-y-0.5">{tree.map(renderNode)}</ul>
      </nav>
    </>
  );
}

/** Create a folder inside the chosen parent, or rename an existing one. */
export function FolderDialog({ open, mode, parentName, initialName, busy, onOpenChange, onSubmit }: {
  open: boolean;
  mode: "create" | "rename";
  parentName: string | null;
  initialName: string;
  busy: boolean;
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
      <DialogContent className="max-w-md border-white/10 bg-[#050708]/95">
        <div>
          <DialogTitle className="mb-2 flex items-center gap-2 text-sm font-semibold"><FolderPlus size={16} className="text-[var(--ac)]" />{mode === "create" ? "New folder" : "Rename folder"}</DialogTitle>
          <DialogDescription className="text-xs leading-5 text-white/40">
            {mode === "create"
              ? parentName && !topLevel ? `It will sit inside ${parentName}.` : "It will sit at the top level."
              : "Pages inside keep their order and history."}
          </DialogDescription>
        </div>
        <label className="space-y-1.5 text-xs text-white/50">
          <span>Name</span>
          <input
            autoFocus
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && !invalid && !busy) void onSubmit(clean, topLevel); }}
            className="h-10 w-full rounded-lg border border-white/10 bg-black/50 px-3 text-sm text-white outline-none focus:border-[var(--ac)]/35"
            placeholder="e.g. Agile Development"
          />
        </label>
        {clean.includes("/") && <p className="text-[11px] text-amber-200/80">A folder name can't contain “/”.</p>}
        {mode === "create" && parentName && (
          <label className="flex items-center gap-2 text-xs text-white/50">
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
