import { AlarmClock, BellRing, BrainCircuit, Check, ChevronRight, Lightbulb, StickyNote } from "lucide-react";
import { SAVED_KIND_LABEL, type SavedItem, type SavedItemKind, type SavedItems } from "./saved-items.js";

function KindIcon({ kind }: { kind: SavedItemKind }) {
  const props = { size: 12, "aria-hidden": true as const, className: "shrink-0 text-emerald-200/70" };
  switch (kind) {
    case "note": return <StickyNote {...props} />;
    case "idea": return <Lightbulb {...props} />;
    case "reminder": return <BellRing {...props} />;
    case "watch": return <AlarmClock {...props} />;
    case "memory": return <BrainCircuit {...props} />;
  }
}

/**
 * Names exactly what AVA saved during this reply. Each row opens the saved
 * item, so Sir can check it instead of trusting the reply's wording.
 */
export function SavedItemsCard({ saved, onOpen }: { saved: SavedItems; onOpen?: (item: SavedItem) => void }) {
  return (
    <section
      data-testid="saved-items"
      aria-label="Saved by AVA"
      className="mt-1 min-w-0 rounded-xl border border-emerald-300/20 bg-emerald-300/[0.05] px-3 py-2 text-[11px] text-emerald-50/80"
    >
      <div className="flex items-center gap-2 font-medium tracking-wide">
        <Check size={13} aria-hidden="true" />
        <span>Saved</span>
      </div>
      <ul className="mt-1.5 space-y-0.5">
        {saved.items.map((item) => {
          const label = SAVED_KIND_LABEL[item.kind];
          return (
            <li key={`${item.kind}:${item.id}`} className="min-w-0">
              <button
                type="button"
                onClick={() => onOpen?.(item)}
                disabled={!onOpen}
                aria-label={`Open ${label.toLowerCase()}: ${item.title}`}
                className="-mx-1.5 flex w-[calc(100%+0.75rem)] min-w-0 items-center gap-2 rounded-lg px-1.5 py-1.5 text-left outline-none transition-colors hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-emerald-300/60 disabled:cursor-default disabled:hover:bg-transparent"
              >
                <KindIcon kind={item.kind} />
                <span className="shrink-0 text-[9px] uppercase tracking-[0.14em] text-white/40">{label}</span>
                <span className="min-w-0 flex-1 truncate text-white/80">{item.title}</span>
                {onOpen && <ChevronRight size={12} aria-hidden="true" className="shrink-0 text-white/30" />}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
