import { useState } from "react";
import { motion } from "motion/react";
import { ChevronDown, ChevronRight, Terminal } from "lucide-react";

export interface ToolCallChipProps {
  tool: string;
  argSummary?: string;
  result?: string;
  ok?: boolean;
}

export function ToolCallChip({ tool, argSummary, result, ok }: ToolCallChipProps) {
  const [open, setOpen] = useState(false);
  const summary = argSummary ?? "";
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <motion.div layout className="my-1" data-message-row>
      <button
        onClick={() => setOpen((v) => !v)}
        className="ava-chip inline-flex items-center gap-1.5 px-2.5 py-1 font-mono text-[10px]"
      >
        <Chevron size={12} />
        <Terminal size={12} />
        <span>{tool}</span>
        {summary ? <span className="text-[var(--ava-fg-faint)]">/ {summary}</span> : null}
      </button>
      {open && (
        <motion.pre
          layout
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="mt-1 ml-3 whitespace-pre-wrap border-l border-[var(--ava-border)] pl-2 font-mono text-[10px] text-[var(--ava-fg-muted)]"
        >
          {ok === false ? "ERROR: " : ""}{result ?? "(no result)"}
        </motion.pre>
      )}
    </motion.div>
  );
}
