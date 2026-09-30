import { AlarmClock, BellRing, BrainCircuit, Check, ChevronRight, Lightbulb, StickyNote } from "lucide-react";
import { SAVED_KIND_LABEL, type SavedItem, type SavedItemKind, type SavedItems } from "./saved-items.js";

function KindIcon({ kind }: { kind: SavedItemKind }) {
  const props = { size: 15, "aria-hidden": true as const, className: "shrink-0 text-ink-2" };
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
 * item, so Niko can check it instead of trusting the reply's wording.
 */
export function SavedItemsCard({ saved, onOpen }: { saved: SavedItems; onOpen?: (item: SavedItem) => void }) {
  return (
    <section
      data-testid="saved-items"
      aria-label="Saved by AVA"
      className="grid min-w-0 gap-1 rounded-card bg-success-soft p-2 text-meta text-ink"
    >
      <div className="flex items-center gap-2 px-2 pt-1 font-medium text-success">
        <Check size={15} aria-hidden="true" />
        <span>Saved</span>
      </div>
      <ul className="grid gap-0.5">
        {saved.items.map((item) => {
          const label = SAVED_KIND_LABEL[item.kind];
          return (
            <li key={`${item.kind}:${item.id}`} className="min-w-0">
              <button
                type="button"
                onClick={() => onOpen?.(item)}
                disabled={!onOpen}
                aria-label={`Open ${label.toLowerCase()}: ${item.title}`}
                className="ds-focus flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-button px-2 py-1.5 text-left transition-colors hover:bg-glass disabled:cursor-default disabled:hover:bg-transparent"
              >
                <KindIcon kind={item.kind} />
                <span className="shrink-0 font-ui-mono text-label uppercase text-ink-3">{label}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{item.title}</span>
                {onOpen && <ChevronRight size={15} aria-hidden="true" className="shrink-0 text-ink-3" />}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
