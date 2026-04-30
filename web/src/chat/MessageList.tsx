import { useEffect, useRef } from "react";
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

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
      {history.map((m) => (
        <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
          {m.role === "user" ? (
            <div
              className="max-w-[75%] rounded-2xl rounded-br-md px-3.5 py-2 text-sm text-white/95 border border-white/10"
              style={{
                background: "linear-gradient(135deg, rgba(168,85,247,0.18), rgba(59,130,246,0.18))",
                boxShadow: "0 4px 24px -8px rgba(168,85,247,0.35)",
              }}
            >
              {m.text}
            </div>
          ) : (
            <div className="max-w-[85%] text-[15px] leading-[1.6] text-white/90 whitespace-pre-wrap">
              {m.text}
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
          <div className="max-w-[85%] text-sm leading-[1.55] text-white/85 whitespace-pre-wrap">
            {lastFinal.payload.text}
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
