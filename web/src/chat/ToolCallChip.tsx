import { useState } from "react";
import { motion } from "motion/react";

export interface ToolCallChipProps {
  tool: string;
  argSummary?: string;
  result?: string;
  ok?: boolean;
}

export function ToolCallChip({ tool, argSummary, result, ok }: ToolCallChipProps) {
  const [open, setOpen] = useState(false);
  const summary = argSummary ?? "";
  return (
    <motion.div layout className="my-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="font-mono text-[10px] px-2 py-1 rounded-md border border-white/10 text-white/60 hover:text-white/85 hover:border-white/20"
      >
        {open ? "▾" : "▸"} {tool}
        {summary ? ` · ${summary}` : ""}
      </button>
      {open && (
        <motion.pre
          layout
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="mt-1 ml-3 text-[10px] font-mono whitespace-pre-wrap text-white/70 border-l border-white/10 pl-2"
        >
          {ok === false ? "ERROR: " : ""}{result ?? "(no result)"}
        </motion.pre>
      )}
    </motion.div>
  );
}
