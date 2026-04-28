import type { StreamEvent } from "./useChatStream.js";
import { ApprovalCard } from "../approvals/ApprovalCard.js";

export type ChatMessage =
  | { role: "user"; text: string; id: string }
  | { role: "assistant"; text: string; id: string };

export function MessageList({
  history,
  liveEvents,
}: {
  history: ChatMessage[];
  liveEvents: StreamEvent[];
}) {
  const resolved = new Map<string, "approved" | "denied" | "expired">();
  for (const e of liveEvents) {
    if (e.kind === "approval_resolved") resolved.set(e.payload.id, e.payload.status);
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
      {history.map((m) => (
        <div key={m.id} className={m.role === "user" ? "text-right" : ""}>
          <div
            className={
              "inline-block px-3 py-2 rounded-2xl max-w-[80%] " +
              (m.role === "user"
                ? "bg-emerald-700 text-white"
                : "bg-neutral-800 text-neutral-100")
            }
          >
            {m.text}
          </div>
        </div>
      ))}
      {liveEvents.map((e) => {
        if (e.kind === "approval_required") {
          return (
            <ApprovalCard
              key={`${e.runEpoch}-${e.id}`}
              id={e.payload.id}
              tool={e.payload.tool}
              args={e.payload.args}
              summary={e.payload.summary}
              resolvedStatus={resolved.get(e.payload.id) ?? null}
            />
          );
        }
        if (e.kind === "approval_resolved") {
          return null;
        }
        if (e.kind === "thought" || e.kind === "final") {
          return (
            <div key={`${e.runEpoch}-${e.id}`} data-testid={e.kind === "final" ? "final-message" : "thought-message"}>
              <div className="inline-block px-3 py-2 rounded-2xl max-w-[80%] bg-neutral-800 text-neutral-100">
                {e.payload.text}
              </div>
            </div>
          );
        }
        if (e.kind === "tool_call") {
          return (
            <div key={`${e.runEpoch}-${e.id}`} className="text-xs text-neutral-500 font-mono">
              → {e.payload.tool}({JSON.stringify(e.payload.args)})
            </div>
          );
        }
        if (e.kind === "tool_result") {
          return (
            <div key={`${e.runEpoch}-${e.id}`} className="text-xs text-neutral-500 font-mono">
              ← {e.payload.tool} {e.payload.ok ? "ok" : "err"}
            </div>
          );
        }
        if (e.kind === "error") {
          return (
            <div key={`${e.runEpoch}-${e.id}`} className="text-sm text-red-400">
              error: {e.payload.message}
            </div>
          );
        }
        if (e.kind === "killed") {
          return (
            <div key={`${e.runEpoch}-${e.id}`} className="text-sm text-amber-400">
              stopped.
            </div>
          );
        }
        if (e.kind === "gap") {
          return (
            <div key={`${e.runEpoch}-${e.id}`} className="text-xs text-amber-500">
              ⚠ missed {e.payload.to - e.payload.from + 1} events — see Sessions for the full trace.
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
