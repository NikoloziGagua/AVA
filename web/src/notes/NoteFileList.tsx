import { FilePlus2, FileText, GraduationCap } from "lucide-react";
import { Button } from "./NotesPrimitives.js";
import type { Note } from "./api.js";

function filePreview(content: string): string {
  const plain = content
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[`*_~>]/g, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return plain ? `${plain.slice(0, 140)}${plain.length > 140 ? "..." : ""}` : "Empty file";
}

export function NoteFileList({ files, selectedId, folderName, onSelect, onNewFile }: {
  files: Note[];
  selectedId: string | null;
  folderName: string;
  onSelect: (id: string) => void;
  onNewFile: () => void;
}) {
  return (
    <nav aria-label={`Files in ${folderName}`} className="ds-note-files min-w-0">
      <div className="mb-2 flex items-center justify-between gap-2 px-2">
        <div><p className="hud text-meta tracking-[0.15em] text-ink-2">FILES</p><p className="mt-0.5 text-meta text-ink-2">{files.length} in this folder</p></div>
        <Button size="sm" variant="ghost" onClick={onNewFile} aria-label="New file"><FilePlus2 size={14} /></Button>
      </div>
      {files.length ? (
        <ol className="space-y-1">
          {files.map((file) => {
            const selected = file.id === selectedId;
            return (
              <li key={file.id}>
                <button type="button" aria-label={file.title} aria-current={selected ? "page" : undefined} onClick={() => onSelect(file.id)}
                  className={`ds-focus ds-note-file-row ${selected ? "ds-note-file-selected" : ""}`}>
                  {file.documentType === "study" ? <GraduationCap size={14} className="mt-0.5 shrink-0 text-ink-2" /> : <FileText size={14} className="mt-0.5 shrink-0 text-ink-2" />}
                  <span className="min-w-0"><span className="ds-note-file-title">{file.title}</span><span className="ds-note-file-preview">{filePreview(file.content)}</span></span>
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <button type="button" onClick={onNewFile} className="flex min-h-28 w-full flex-col items-center justify-center rounded-xl border border-dashed border-glass-strong px-3 text-center text-meta text-ink-2 hover:border-glass-strong hover:text-ink-2">
          <FilePlus2 size={16} className="mb-2" />Create the first file
        </button>
      )}
    </nav>
  );
}
