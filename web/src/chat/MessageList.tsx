import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useReducedMotion } from "../lib/useReducedMotion.js";
import { cn } from "../design/cn.js";
import { ThinkingIndicator, type ThinkingState } from "./ThinkingIndicator.js";
import { ToolCallChip } from "./ToolCallChip.js";
import { humanizeTool } from "./humanize.js";
import { MessageActions } from "./MessageActions.js";
import { ApprovalCard } from "../approvals/ApprovalCard.js";
import { AssistantMarkdown } from "./AssistantMarkdown.js";
import type { StreamEvent } from "./useChatStream.js";
import { TaskReceiptCard } from "./TaskReceiptCard.js";
import { VisualMessageCard, type VisualSemanticActionHandler } from "../visuals/VisualMessageCard.js";
import type { VisualMessage, VisualMessageContext } from "../visuals/types.js";
import { MemoryContextCapsule } from "./MemoryContextCapsule.js";
import { SavedItemsCard } from "./SavedItemsCard.js";
import { RoomPostReceipt } from "./RoomPostReceipt.js";
import { validRoomPosts, type RoomPosts } from "./room-posts.js";
import type { SavedItem, SavedItems } from "./saved-items.js";
import type { MemoryContext } from "./memory-context.js";

export type ChatMessage =
  | { role: "user"; text: string; id: string; visualContext?: VisualMessageContext; inputSource?: "voice_exact_text" }
  | { role: "assistant"; text: string; id: string; visualMessages?: VisualMessage[]; memoryContext?: MemoryContext; savedItems?: SavedItems; roomPosts?: RoomPosts }
  // `system` rows are server notices (e.g. the "Server restarted…" recovery
  // message) — rendered as a centered notice, never attributed to Ava.
  | { role: "system"; text: string; id: string };

export interface MessageListProps {
  history: ChatMessage[];
  liveEvents: StreamEvent[];
  /** Open something AVA saved (a row of a reply's Saved card). */
  onOpenSaved?: (item: SavedItem) => void;
  /** Re-run the last turn (wired to the action row's Retry). */
  onRetry?: () => void;
  /**
   * The real scroll element — attached here, shared up to ChatScreen so
   * FlowingLines parallax + the bubble ScrollTriggers target the same node.
   */
  scrollerRef?: React.RefObject<HTMLDivElement | null>;
  /**
   * Called with the scroll node when it mounts (and null on unmount). Lets
   * ChatScreen track the node *identity* in state so FlowingLines' parallax
   * re-attaches if the scroller is replaced on a session switch.
   */
  onScrollerMount?: (node: HTMLDivElement | null) => void;
  /**
   * Optimistic thinking: true the same frame a message is sent (ChatScreen's
   * synchronous `pending` flag), so the premium indicator appears instantly —
   * BEFORE the first liveEvent arrives. Drives ThinkingIndicator, not the old
   * `liveEvents.length > 0` heuristic (which lagged by the SSE round-trip).
   */
  optimisticThinking?: boolean;
  /** Live working state — feeds the indicator's chip + caption. */
  executing?: boolean;
  runningTool?: string | null;
  headerState?: "idle" | "thinking" | "responding";
  onVisualSemanticAction?: VisualSemanticActionHandler;
}

export function MessageList({
  history,
  liveEvents,
  onRetry,
  onOpenSaved,
  scrollerRef,
  onScrollerMount,
  optimisticThinking = false,
  executing = false,
  runningTool,
  headerState = "idle",
  onVisualSemanticAction,
}: MessageListProps) {
  const reduced = useReducedMotion();
  const internalRef = useRef<HTMLDivElement>(null);
  const scroller = scrollerRef ?? internalRef;
  const endRef = useRef<HTMLDivElement>(null);

  // Callback ref: keep the shared ref object's `.current` in sync AND notify
  // ChatScreen of the node identity.
  const attachScroller = (node: HTMLDivElement | null) => {
    (scroller as React.MutableRefObject<HTMLDivElement | null>).current = node;
    onScrollerMount?.(node);
  };

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "end" });
  }, [history.length, liveEvents.length, optimisticThinking, reduced]);

  const resolved = new Map<string, "approved" | "denied" | "expired">();
  for (const e of liveEvents) {
    if (e.kind === "approval_resolved") resolved.set(e.payload.id, e.payload.status);
  }

  const lastFinal = [...liveEvents].reverse().find((e) => e.kind === "final");
  // Approval snapshots and the terminal result use the same receipt event. Only
  // the newest snapshot is authoritative for the current run.
  const lastReceipt = [...liveEvents].reverse().find((e) => e.kind === "receipt");
  const liveMemoryContext = [...liveEvents].reverse().find((e) => e.kind === "memory_context");
  // Each saved_items event is cumulative, so the newest one is the whole list.
  const liveSavedItems = [...liveEvents].reverse().find((e) => e.kind === "saved_items");
  const liveRoomPosts = [...liveEvents].reverse().find((e) => e.kind === "room_posts");

  // Retry re-runs the LAST turn (ChatScreen's retryLast), so it only belongs on
  // the LAST assistant bubble — on every bubble it implied re-running THAT turn.
  // The live final (when present) is the newest reply and owns Retry instead.
  const lastAssistantHistoryId = [...history].reverse().find((m) => m.role === "assistant")?.id;

  // ── Live streaming text for the in-flight turn ──────────────────────────
  // liveEvents is already filtered to the current runEpoch by ChatScreen, so
  // accumulating every `delta` text yields exactly this run's streamed reply —
  // and it resets automatically next run (liveEvents only holds the new epoch).
  //
  // Memoized on `liveEvents` so we don't re-filter+map+join the entire growing
  // array on every render (each delta would otherwise re-scan all prior events,
  // an O(n²)-per-turn cost). The result is byte-identical to the eager version.
  const streamingText = useMemo(
    () =>
      liveEvents
        .filter((e): e is Extract<StreamEvent, { kind: "delta" }> => e.kind === "delta")
        .map((e) => e.payload.text)
        .join(""),
    [liveEvents],
  );
  // A run is terminated once it has been killed or errored.
  const runTerminated = liveEvents.some((e) => e.kind === "killed" || e.kind === "error");

  // No live token-by-token bubble. Reasoning models (gpt-5.5) "think" for seconds then
  // emit the WHOLE reply in a sub-100ms burst, so a live bubble either flashed past
  // unseen or (worse) rendered empty. Instead the thinking indicator stays up until the
  // reply is ready, then the FINAL block renders its complete Markdown tree in one
  // stable pass. `streamingText` is still accumulated so Stop can show the partial
  // answer without discarding headings, lists, or code that already arrived.

  // Caption: backward-walk the live stream (verified mechanism). Before any
  // liveEvent (the optimistic window) it seeds "thinking…", then upgrades the
  // instant events stream in.
  let thinkingCaption = "thinking…";
  for (let i = liveEvents.length - 1; i >= 0; i--) {
    const e = liveEvents[i];
    if (e?.kind === "tool_call") { thinkingCaption = humanizeTool(e.payload.tool, e.payload.args) + "…"; break; }
    if (e?.kind === "thought") { thinkingCaption = e.payload.text.slice(0, 80); break; }
  }

  const thinkingState: ThinkingState = executing
    ? "executing"
    : headerState === "responding"
      ? "responding"
      : "thinking";

  // Thinking row shows from send until the final reply arrives.
  const showThinking = optimisticThinking && !lastFinal && !runTerminated;


  return (
    <div ref={attachScroller} className="relative min-h-0 flex-1 overflow-y-auto px-4 py-6">
      {/* Bottom-anchor: a short conversation sits just above the bar; a long
          one scrolls, with endRef keeping the newest line in view. */}
      <div className="mx-auto flex min-h-full w-full max-w-[720px] flex-col justify-end gap-7">
      {history.map((m) => {
        if (m.role === "system") {
          return (
            <div key={m.id} className={cn("flex justify-center", arrived(m.id))}>
              <SystemNotice text={m.text} />
            </div>
          );
        }
        return (
        <div key={m.id} className={cn(m.role === "user" ? "flex justify-end" : "flex justify-start", arrived(m.id))}>
          {m.role === "user" ? (
            <div className="flex max-w-[85%] flex-col items-end gap-1.5">
              <OwnerBubble text={m.text} />
              {m.inputSource === "voice_exact_text" && <MessageTag>Exact text · entered in voice</MessageTag>}
              {m.visualContext && (
                <MessageTag>
                  Visual context · rev {m.visualContext.revision} · {m.visualContext.selectedElementIds.length || "scene"}
                </MessageTag>
              )}
            </div>
          ) : (
            <AvaMessage>
              <AssistantMarkdown text={m.text} />
              {m.memoryContext && <MemoryContextCapsule context={m.memoryContext} />}
              {m.savedItems && <SavedItemsCard saved={m.savedItems} onOpen={onOpenSaved} />}
              {m.roomPosts && <RoomPostReceipt posts={m.roomPosts} />}
              <MessageActions
                text={m.text}
                onRetry={!lastFinal && m.id === lastAssistantHistoryId ? onRetry : undefined}
              />
              {m.visualMessages?.map((visual) => (
                <VisualMessageCard
                  key={`${visual.visualMessageId}:${visual.revision}`}
                  visual={visual}
                  onSemanticAction={onVisualSemanticAction}
                />
              ))}
            </AvaMessage>
          )}
        </div>
        );
      })}

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
              riskTier={e.payload.riskTier}
              timeoutBehavior={e.payload.timeoutBehavior}
              requestedAt={e.payload.requestedAt}
              deadlineAt={e.payload.deadlineAt}
              timeoutMs={e.payload.timeoutMs}
            />
          );
        }
        // Each step shows in the island and its steps sheet (contract ui-remodel
        // v2 §7); the conversation itself only shows a step that failed.
        if (e.kind === "tool_call") return null;
        if (e.kind === "tool_result") {
          if (e.payload.ok) return null;
          return <ToolCallChip key={key} label={humanizeTool(e.payload.tool)} ok={false} result={e.payload.result} />;
        }
        if (e.kind === "thought") {
          return null; // thoughts surface via the thinking caption, not rendered as message
        }
        if (e.kind === "error") {
          return <p key={key} role="alert" className="rounded-card bg-danger-soft px-4 py-2.5 text-meta text-danger">error: {e.payload.message}</p>;
        }
        if (e.kind === "killed") {
          // Stop mid-reply must NOT discard whatever was generated. There's no live
          // bubble now, so on Stop render the accumulated partial PLAINLY above the
          // "stopped." chip. Guarded on `!lastFinal` so a (rare) final + killed race
          // never double-renders.
          const showPartial = streamingText.length > 0 && !lastFinal;
          return (
            <div key={key} className="space-y-3">
              {showPartial && (
                <div className="flex justify-start" data-testid="stopped-partial">
                  <AvaMessage>
                    <AssistantMarkdown text={streamingText} partial />
                  </AvaMessage>
                </div>
              )}
              <p className="w-fit rounded-full bg-warning-soft px-3 py-1.5 text-meta text-warning">Stopped.</p>
            </div>
          );
        }
        if (e.kind === "gap") {
          return (
            <p key={key} role="status" className="rounded-card bg-warning-soft px-4 py-2.5 text-meta text-warning">
              I missed {e.payload.to - e.payload.from + 1} live events — reopen this chat to refresh.
            </p>
          );
        }
        if (e.kind === "receipt") return null;
        if (e.kind === "memory_context") return null;
        if (e.kind === "saved_items") return null;
        if (e.kind === "room_posts") return null;
        return null;
      })}

      {lastFinal && (
        <div className="ds-rise flex justify-start" data-testid="final-message">
          <AvaMessage>
            <AssistantMarkdown
              text={lastFinal.payload.text}
            />
            {liveMemoryContext?.kind === "memory_context" && (
              <MemoryContextCapsule context={liveMemoryContext.payload} />
            )}
            {liveSavedItems?.kind === "saved_items" && (
              <SavedItemsCard saved={liveSavedItems.payload} onOpen={onOpenSaved} />
            )}
            {liveRoomPosts?.kind === "room_posts" && validRoomPosts(liveRoomPosts.payload) && (
              <RoomPostReceipt posts={validRoomPosts(liveRoomPosts.payload)!} />
            )}
            <MessageActions text={lastFinal.payload.text} onRetry={onRetry} />
          </AvaMessage>
        </div>
      )}

      {!lastFinal && runTerminated && liveMemoryContext?.kind === "memory_context" && (
        <div className="grid" data-testid="terminated-memory-context">
          <MemoryContextCapsule context={liveMemoryContext.payload} />
        </div>
      )}

      {/* A run that failed or was stopped may still have saved something. */}
      {!lastFinal && runTerminated && liveSavedItems?.kind === "saved_items" && (
        <div className="grid" data-testid="terminated-saved-items">
          <SavedItemsCard saved={liveSavedItems.payload} onOpen={onOpenSaved} />
        </div>
      )}
      {!lastFinal && runTerminated && liveRoomPosts?.kind === "room_posts" && validRoomPosts(liveRoomPosts.payload) && (
        <div className="grid" data-testid="terminated-room-posts">
          <RoomPostReceipt posts={validRoomPosts(liveRoomPosts.payload)!} />
        </div>
      )}

      {lastReceipt?.kind === "receipt" && <TaskReceiptCard receipt={lastReceipt.payload} />}

      {showThinking && (
        <div className="ds-rise flex justify-start">
          <ThinkingIndicator
            caption={thinkingCaption}
            state={thinkingState}
            tool={executing ? runningTool ?? undefined : undefined}
            reduced={reduced}
          />
        </div>
      )}

        <div ref={endRef} />
      </div>
    </div>
  );
}

/** Only messages that arrive while the chat is open rise in; a reopened history is simply there. */
function arrived(id: string): string | undefined {
  return id.startsWith("s-") ? undefined : "ds-rise";
}

/**
 * A server-originated notice (e.g. the "Server restarted…" recovery row), shown
 * as a quiet centred note so it reads as a system event, not an AVA reply.
 * Keeping it distinct is also what stops it from poisoning the reopen dedupe.
 */
function SystemNotice({ text }: { text: string }) {
  return (
    <p className="max-w-[85%] rounded-full bg-glass px-4 py-1.5 text-center text-meta text-ink-2">
      {text}
    </p>
  );
}

function MessageTag({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-glass px-2.5 py-1 text-label text-ink-2">{children}</span>;
}

/** Niko's message: a soft bubble on the right. Line breaks are kept. */
function OwnerBubble({ text }: { text: string }) {
  return (
    <div className="max-w-full whitespace-pre-wrap break-words rounded-card rounded-br-control bg-surface-strong px-4 py-2.5 text-body text-ink shadow-e1">
      {text}
    </div>
  );
}

/**
 * AVA's reply: no bubble, just the text on the page (Markdown on paper), with
 * whatever the reply saved or used underneath and its action row last.
 */
function AvaMessage({ children }: { children: ReactNode }) {
  // group/msg lets the action row brighten on hover on a desktop.
  return <article className="group/msg grid w-full min-w-0 gap-3">{children}</article>;
}
