import { useState } from "react";
import { motion } from "motion/react";

export interface ToolCallChipProps {
  /** Humanized, present-tense action, e.g. "Running git status". */
  label: string;
  /** Raw tool output — tucked behind a click, never shown by default. */
  result?: string;
  ok?: boolean;
}

/**
 * A clean breadcrumb of one action: a tinted dot + a human label. The raw tool
 * output (stdout / exit codes / JSON) is hidden behind a click so the chat flow
 * stays legible — only failures and curious taps reveal the guts.
 */
export function ToolCallChip({ label, result, ok }: ToolCallChipProps) {
  const [open, setOpen] = useState(false);
  const failed = ok === false;
  const hasDetail = !!result;
  return (
    <motion.div layout className="my-0.5">
      <button
        onClick={hasDetail ? () => setOpen((v) => !v) : undefined}
        className="flex items-center gap-1.5 text-[11px] text-white/50 hover:text-white/80 transition-colors"
        style={{ cursor: hasDetail ? "pointer" : "default" }}
      >
        <span
          className="inline-block h-1 w-1 rounded-full"
          style={{
            background: failed ? "var(--ac-stop)" : "var(--ac)",
            boxShadow: failed ? "0 0 6px var(--ac-stop)" : "0 0 6px var(--ac)",
          }}
        />
        <span>{label}</span>
        {hasDetail && <span className="text-white/30">{open ? "▾" : "▸"}</span>}
      </button>
      {open && hasDetail && (
        <motion.pre
          layout
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="mt-1 ml-3 max-h-40 overflow-y-auto border-l border-white/10 pl-2 text-[10px] font-mono whitespace-pre-wrap text-white/55"
        >
          {failed ? "ERROR: " : ""}{result}
        </motion.pre>
      )}
    </motion.div>
  );
}
