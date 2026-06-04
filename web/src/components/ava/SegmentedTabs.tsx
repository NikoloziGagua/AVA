import { useLayoutEffect, useRef, useState } from "react";
import { motion } from "motion/react";

export interface SegmentedTabOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

export interface SegmentedTabsProps<T extends string> {
  options: SegmentedTabOption<T>[];
  value: T;
  onChange: (next: T) => void;
  /** "full" = each option is its own column; "auto" = label width. */
  layout?: "full" | "auto";
  className?: string;
}

interface Cursor { left: number; width: number; }

export function SegmentedTabs<T extends string>({
  options, value, onChange, layout = "full", className,
}: SegmentedTabsProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [cursor, setCursor] = useState<Cursor | null>(null);

  useLayoutEffect(() => {
    const node = tabRefs.current[value];
    const container = containerRef.current;
    if (!node || !container) return;
    const rect = node.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();
    setCursor({ left: rect.left - cRect.left, width: rect.width });
  }, [value, options.length]);

  return (
    <div
      ref={containerRef}
      className={
        "relative inline-flex rounded-[8px] border border-[var(--ava-border)] bg-[rgba(247,239,226,0.055)] p-1 " +
        (layout === "full" ? "w-full" : "w-fit") + " " +
        (className ?? "")
      }
    >
      {cursor && (
        <motion.div
          className="absolute top-1 bottom-1 rounded-[6px] border border-[rgba(216,189,131,0.26)] bg-[rgba(216,189,131,0.14)]"
          animate={{ left: cursor.left, width: cursor.width }}
          transition={{ type: "spring", stiffness: 400, damping: 32 }}
        />
      )}
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            ref={(el) => { tabRefs.current[opt.value] = el; }}
            onClick={() => onChange(opt.value)}
            className={
              "relative z-10 px-3 py-1.5 text-xs uppercase tracking-wider transition-colors " +
              (layout === "full" ? "flex-1" : "") + " " +
              (active ? "text-[var(--ava-ink)]" : "text-[var(--ava-fg-muted)] hover:text-[var(--ava-ink)]")
            }
          >
            <span className="block">{opt.label}</span>
            {opt.hint && (
              <span className="mt-0.5 block text-[9px] normal-case tracking-normal text-[var(--ava-fg-faint)]">
                {opt.hint}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
