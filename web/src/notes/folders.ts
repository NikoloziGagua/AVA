import { GENERAL_FOLDER_ID, type Note, type NoteFolder } from "./api.js";

/** notes-hierarchy v3 study template: one Markdown body with these headings. */
export const STUDY_HEADINGS = [
  "Key concepts",
  "Explanations",
  "Questions and weak areas",
  "Examples",
  "Conclusions",
  "Sources",
] as const;

export const STUDY_TEMPLATE = STUDY_HEADINGS.map((heading) => `## ${heading}\n\n`).join("");

export function noteFolderId(note: Note): string {
  return note.folderId ?? GENERAL_FOLDER_ID;
}

export type FolderNode = { folder: NoteFolder; depth: number; children: FolderNode[] };

function byPosition(a: NoteFolder, b: NoteFolder): number {
  // General always leads; then the stored order, then a stable name/id tie-break.
  if (a.id === GENERAL_FOLDER_ID) return -1;
  if (b.id === GENERAL_FOLDER_ID) return 1;
  return a.position - b.position ||
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
    a.id.localeCompare(b.id);
}

/** Nest the flat folder list. A folder whose parent is missing is shown at the top level. */
export function buildFolderTree(folders: NoteFolder[]): FolderNode[] {
  const ids = new Set(folders.map((folder) => folder.id));
  const children = new Map<string | null, NoteFolder[]>();
  for (const folder of folders) {
    const parent = folder.parentId && ids.has(folder.parentId) ? folder.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), folder]);
  }
  const seen = new Set<string>();
  const build = (parent: string | null, depth: number): FolderNode[] =>
    (children.get(parent) ?? []).slice().sort(byPosition).flatMap((folder) => {
      if (seen.has(folder.id)) return [];
      seen.add(folder.id);
      return [{ folder, depth, children: build(folder.id, depth + 1) }];
    });
  return build(null, 0);
}

/** Depth-first order, used by the phone folder menu and the folder pickers. */
export function flattenFolderTree(nodes: FolderNode[]): FolderNode[] {
  return nodes.flatMap((node) => [node, ...flattenFolderTree(node.children)]);
}

export function folderLabel(folder: NoteFolder): string {
  return folder.path || folder.breadcrumb.map((crumb) => crumb.name).join(" / ") || folder.name;
}

/** The pages of one folder in book order: stored position, then title, then id. */
export function folderPages(notes: Note[], folderId: string): Note[] {
  return notes
    .filter((note) => note.status !== "archived" && noteFolderId(note) === folderId)
    .sort((a, b) =>
      (a.documentPosition ?? 0) - (b.documentPosition ?? 0) ||
      a.title.localeCompare(b.title, undefined, { sensitivity: "base" }) ||
      a.id.localeCompare(b.id));
}

export function matchesQuery(note: Note, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [note.title, note.content, note.kind, ...note.tags].join(" ").toLocaleLowerCase().includes(needle);
}

/** Folders created from pre-folder project spaces, for the one-time migration notice. */
export function legacyFolders(folders: NoteFolder[], legacyIds: string[]): NoteFolder[] {
  const ids = new Set(legacyIds);
  return folders.filter((folder) => ids.has(folder.id));
}
