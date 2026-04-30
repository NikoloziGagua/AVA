import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import { Pulse } from "../components/ava/Pulse.js";
import { ShiningText } from "../components/ava/ShiningText.js";
import { ToolCallChip } from "./ToolCallChip.js";
import { ApprovalCard } from "../approvals/ApprovalCard.js";
import type { StreamEvent } from "./useChatStream.js";

export type ChatMessage =
  | { role: "user"; text: string; id: string }
  | { role: "assistant"; text: string; id: string };

export interface MessageListProps {
  history: ChatMessage[];
  liveEvents: StreamEvent[];
}

export function MessageList({ history, liveEvents }: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [history.length, liveEvents.length]);

  const resolved = new Map<string, "approved" | "denied" | "expired">();
  for (const e of liveEvents) {
    if (e.kind === "approval_resolved") resolved.set(e.payload.id, e.payload.status);
  }

  const hasTerminal = liveEvents.some(
    (e) => e.kind === "done" || e.kind === "killed" || e.kind === "error",
  );
  const lastFinal = [...liveEvents].reverse().find((e) => e.kind === "final");
  const isThinking = liveEvents.length > 0 && !lastFinal && !hasTerminal;

  let thinkingCaption = "thinking…";
  for (let i = liveEvents.length - 1; i >= 0; i--) {
    const e = liveEvents[i];
    if (e?.kind === "tool_call") { thinkingCaption = `running ${e.payload.tool}…`; break; }
    if (e?.kind === "thought") { thinkingCaption = e.payload.text.slice(0, 80); break; }
  }

  const isEmpty = history.length === 0 && liveEvents.length === 0;

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 space-y-5">
      {isEmpty && (
        <motion.div
          className="flex flex-col items-center justify-center h-full min-h-[55vh] text-center pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
        >
          <motion.div
            initial={{ opacity: 0, filter: "blur(20px)", y: 8 }}
            animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
            transition={{ duration: 1.0, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
          >
            <div className="text-[10px] tracking-[0.45em] uppercase text-white/40 mb-2">I AM</div>
            <div className="text-7xl sm:text-8xl font-bold tracking-[0.2em] bg-clip-text text-transparent bg-gradient-to-b from-white via-white/85 to-white/40">
              AVA
            </div>
          </motion.div>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.6 }}
            className="mt-6 text-sm text-white/45 max-w-xs"
          >
            How can I help today? Type a message, tap a chip, or hold the orb to speak.
          </motion.p>
        </motion.div>
      )}
      {history.map((m) => (
        <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
          {m.role === "user" ? (
            <div
              className="group relative max-w-[78%] rounded-2xl rounded-br-md px-4 py-2.5 text-[14.5px] text-white/95 overflow-hidden"
              style={{
                background:
                  "linear-gradient(135deg, rgba(168,85,247,0.22), rgba(59,130,246,0.22))",
                border: "1px solid rgba(255,255,255,0.10)",
                backdropFilter: "blur(14px) saturate(150%)",
                WebkitBackdropFilter: "blur(14px) saturate(150%)",
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.18), 0 8px 28px -10px rgba(168,85,247,0.45)",
              }}
            >
              <span className="relative">{m.text}</span>
            </div>
          ) : (
            <div className="flex items-start gap-3 max-w-[88%]">
              <div className="shrink-0 mt-1.5">
                <Pulse state="idle" size={10} />
              </div>
              <div
                className="text-[15px] leading-[1.65] whitespace-pre-wrap bg-clip-text text-transparent"
                style={{
                  backgroundImage:
                    "linear-gradient(180deg, rgba(255,255,255,0.96), rgba(226,232,240,0.85))",
                }}
              >
                {m.text}
              </div>
            </div>
          )}
        </div>
      ))}

      {liveEvents.map((e) => {
        const key = `${e.runEpoch}-${e.id}`;
        if (e.kind === "approval_required") {
          return (
            <ApprovalCard
              key={key}
              id={e.payload.id}
              tool={e.payload.tool}
              args={e.payload.args}
              summary={e.payload.summary}
              resolvedStatus={resolved.get(e.payload.id) ?? null}
            />
          );
        }
        if (e.kind === "tool_call") {
          const summary = typeof e.payload.args === "object"
            ? JSON.stringify(e.payload.args).slice(0, 40)
            : String(e.payload.args);
          return <ToolCallChip key={key} tool={e.payload.tool} argSummary={summary} />;
        }
        if (e.kind === "tool_result") {
          return <ToolCallChip key={key} tool={e.payload.tool} ok={e.payload.ok} result={e.payload.result} />;
        }
        if (e.kind === "thought") {
          return null; // thoughts surface via thinkingCaption, not rendered as message
        }
        if (e.kind === "error") {
          return <div key={key} className="text-sm text-red-400">error: {e.payload.message}</div>;
        }
        if (e.kind === "killed") {
          return <div key={key} className="text-sm text-amber-400">stopped.</div>;
        }
        if (e.kind === "gap") {
          return (
            <div key={key} className="text-xs text-amber-500">
              ⚠ missed {e.payload.to - e.payload.from + 1} events — see Sessions for the full trace.
            </div>
          );
        }
        return null;
      })}

      {lastFinal && (
        <div className="flex justify-start" data-testid="final-message">
          <div className="flex items-start gap-3 max-w-[88%]">
            <div className="shrink-0 mt-1.5">
              <Pulse state="responding" size={10} />
            </div>
            <div
              className="text-[15px] leading-[1.65] whitespace-pre-wrap bg-clip-text text-transparent"
              style={{
                backgroundImage:
                  "linear-gradient(180deg, rgba(255,255,255,0.96), rgba(226,232,240,0.85))",
              }}
            >
              {lastFinal.payload.text}
            </div>
          </div>
        </div>
      )}

      {isThinking && (
        <div className="flex items-center gap-2 text-white/60">
          <Pulse state="thinking" size={14} />
          <ShiningText text={thinkingCaption} className="text-xs" />
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
}
