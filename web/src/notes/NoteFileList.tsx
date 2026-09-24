import { FilePlus2, FileText, GraduationCap } from "lucide-react";
import { Button } from "../components/ui/button.js";
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
    <nav aria-label={`Files in ${folderName}`} className="min-w-0 rounded-2xl border border-white/[0.07] bg-black/25 px-2.5 py-3 md:max-h-[720px] md:overflow-y-auto">
      <div className="mb-2 flex items-center justify-between gap-2 px-2">
        <div><p className="hud text-[9px] tracking-[0.15em] text-white/35">FILES</p><p className="mt-0.5 text-[10px] text-white/30">{files.length} in this folder</p></div>
        <Button size="sm" variant="ghost" onClick={onNewFile} aria-label="New file"><FilePlus2 size={14} /></Button>
      </div>
      {files.length ? (
        <ol className="space-y-1">
          {files.map((file) => {
            const selected = file.id === selectedId;
            return (
              <li key={file.id}>
                <button type="button" aria-label={file.title} aria-current={selected ? "page" : undefined} onClick={() => onSelect(file.id)}
                  className={`flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition motion-reduce:transition-none ${selected ? "border-[var(--ac)]/25 bg-[var(--ac)]/[0.08] text-white" : "border-transparent text-white/55 hover:border-white/[0.07] hover:bg-white/[0.035] hover:text-white"}`}>
                  {file.documentType === "study" ? <GraduationCap size={14} className="mt-0.5 shrink-0 text-[#bb8cff]" /> : <FileText size={14} className="mt-0.5 shrink-0 text-white/35" />}
                  <span className="min-w-0"><span className="block truncate text-xs font-medium">{file.title}</span><span className="mt-1 block max-h-8 overflow-hidden text-[9px] leading-4 text-white/30">{filePreview(file.content)}</span></span>
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <button type="button" onClick={onNewFile} className="flex min-h-28 w-full flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] px-3 text-center text-[10px] text-white/35 hover:border-[var(--ac)]/25 hover:text-white/60">
          <FilePlus2 size={16} className="mb-2" />Create the first file
        </button>
      )}
    </nav>
  );
}
