import { useEffect, useMemo, useRef } from "react";
import { gsap, useGSAP, ScrollTrigger } from "../lib/gsap.js";
import { D, EASE, SHADOW, hoverLift } from "../lib/deckMotion.js";
import { useReducedMotion } from "../lib/useReducedMotion.js";
import { Orb } from "../components/ava/Orb.js";
import { WordReveal } from "../components/ava/WordReveal.js";
import { StreamingReveal } from "../components/ava/StreamingReveal.js";
import { ThinkingIndicator, type ThinkingState } from "./ThinkingIndicator.js";
import { ToolCallChip } from "./ToolCallChip.js";
import { humanizeTool } from "./humanize.js";
import { MessageActions } from "./MessageActions.js";
import { ApprovalCard } from "../approvals/ApprovalCard.js";
import type { StreamEvent } from "./useChatStream.js";

export type ChatMessage =
  | { role: "user"; text: string; id: string }
  | { role: "assistant"; text: string; id: string };

export interface MessageListProps {
  history: ChatMessage[];
  liveEvents: StreamEvent[];
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
}

export function MessageList({
  history,
  liveEvents,
  onRetry,
  scrollerRef,
  onScrollerMount,
  optimisticThinking = false,
  executing = false,
  runningTool,
  headerState = "idle",
}: MessageListProps) {
  const reduced = useReducedMotion();
  const internalRef = useRef<HTMLDivElement>(null);
  const scroller = scrollerRef ?? internalRef;
  const endRef = useRef<HTMLDivElement>(null);
  const breathKilled = useRef(false);

  // Callback ref: keep the shared ref object's `.current` in sync (so the
  // ScrollTriggers below can read it) AND notify ChatScreen of the node identity.
  const attachScroller = (node: HTMLDivElement | null) => {
    (scroller as React.MutableRefObject<HTMLDivElement | null>).current = node;
    onScrollerMount?.(node);
  };

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [history.length, liveEvents.length, optimisticThinking]);

  const resolved = new Map<string, "approved" | "denied" | "expired">();
  for (const e of liveEvents) {
    if (e.kind === "approval_resolved") resolved.set(e.payload.id, e.payload.status);
  }

  const lastFinal = [...liveEvents].reverse().find((e) => e.kind === "final");

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
  // A run is terminated once it has been killed or errored; on those paths there
  // is no `final`, so we must stop growing the streaming bubble explicitly.
  const runTerminated = liveEvents.some((e) => e.kind === "killed" || e.kind === "error");
  // Show the live streaming bubble only while text is arriving and the run has
  // neither finalized nor terminated. The `final` (or kill/error) flips this off,
  // unmounting the streaming bubble in favor of the final block / stopped chip.
  const isStreaming = streamingText.length > 0 && !lastFinal && !runTerminated;
  // True if this run streamed any text before its `final`.
  const turnStreamed = streamingText.length > 0;

  // ── Reveal handoff timing ───────────────────────────────────────────────
  // Reasoning models (gpt-5.5) "think" for seconds, then emit ALL their output
  // text in a sub-100ms burst — so the live StreamingReveal flashes by unseen and
  // the final block, rendered plainly because the turn technically "streamed",
  // looked like the whole reply just popped in (the "text animation doesn't work
  // when I text" report). Track how long text was actually on screen: if the
  // visible stream was a burst (< REVEAL_MS, or arrived all in one commit so the
  // start was never even recorded), animate the final so the word-by-word reveal
  // is perceptible. A genuinely slow/long stream (visible ≥ REVEAL_MS) still hands
  // off plainly — its words already revealed live, so no second-reveal flash.
  const REVEAL_MS = 550;
  const streamStartRef = useRef<number | null>(null);
  useEffect(() => {
    if (streamingText.length > 0 && streamStartRef.current === null) {
      streamStartRef.current = performance.now();
    } else if (streamingText.length === 0 && !lastFinal) {
      streamStartRef.current = null; // armed for the next turn
    }
  }, [streamingText, lastFinal]);

  // Freeze the decision the first time this run's final appears, so later
  // re-renders don't flip `animate` and re-trigger the reveal.
  const finalDecisionRef = useRef<{ key: string; animate: boolean } | null>(null);
  let animateFinal = !turnStreamed;
  if (lastFinal) {
    const key = `${lastFinal.runEpoch}-${lastFinal.id}`;
    if (finalDecisionRef.current?.key !== key) {
      // null start = everything arrived in one commit (instant burst) → 0ms visible.
      const visibleMs = streamStartRef.current === null ? 0 : performance.now() - streamStartRef.current;
      finalDecisionRef.current = { key, animate: !turnStreamed || visibleMs < REVEAL_MS };
    }
    animateFinal = finalDecisionRef.current.animate;
  }

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

  // Gate the thinking row off the instant the first delta arrives — the live
  // streaming bubble takes its place in the same AvaBubble geometry (no jump).
  const showThinking = optimisticThinking && !lastFinal && !isStreaming;

  // ── Single source of truth for bubble reveals: ScrollTrigger.batch ──
  // ScrollTrigger.batch fires onEnter for elements already in view at creation
  // time too, so it covers BOTH the just-appended newest bubble AND older
  // bubbles scrolling into view — no separate per-append gsap.from (which used
  // to double-animate the newest node, fighting over opacity/transform).
  //
  // `[data-bubble]:not([data-entered])` keeps the set disjoint across re-runs:
  // already-revealed bubbles carry data-entered and are skipped when the batch
  // is rebuilt (history.length changes), so each bubble animates exactly once.
  // useGSAP reverts tweens but does NOT kill ScrollTriggers — capture + kill.
  useGSAP(
    () => {
      if (reduced || !scroller.current) return;
      const triggers: ScrollTrigger[] = [];
      ScrollTrigger.batch("[data-bubble]:not([data-entered])", {
        scroller: scroller.current,
        start: "top 92%",
        once: true,
        onEnter: (els) => {
          els.forEach((el) => el.setAttribute("data-entered", ""));
          gsap.from(els, {
            y: 18,
            opacity: 0,
            filter: "blur(6px)",
            duration: D.section,
            ease: EASE,
            stagger: 0.06,
            overwrite: true,
            clearProps: "filter",
          });
        },
      });
      ScrollTrigger.getAll().forEach((t) => {
        if (t.scroller === scroller.current) triggers.push(t);
      });
      return () => triggers.forEach((t) => t.kill());
    },
    { scope: scroller, dependencies: [history.length] },
  );

  // ── Cross-fade the thinking row out the moment the final block streams in ──
  useGSAP(
    () => {
      if (reduced || !lastFinal || breathKilled.current) return;
      breathKilled.current = true;
      const row = scroller.current?.querySelector("[data-thinking]");
      if (row) gsap.to(row, { opacity: 0, y: -6, duration: D.fast, ease: "power2.in" });
    },
    { scope: scroller, dependencies: [!!lastFinal] },
  );
  // Re-arm the cross-fade gate for the next run (when the final clears).
  useEffect(() => {
    if (!lastFinal) breathKilled.current = false;
  }, [lastFinal]);

  return (
    <div ref={attachScroller} className="no-scrollbar relative flex-1 overflow-y-auto px-4 py-6 space-y-5">
      {history.map((m) => (
        <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
          {m.role === "user" ? (
            <OwnerBubble text={m.text} reduced={reduced} />
          ) : (
            <AvaBubble reduced={reduced}>
              <div
                className="text-[15px] leading-[1.65] whitespace-pre-wrap bg-clip-text text-transparent"
                style={{
                  backgroundImage:
                    "linear-gradient(180deg, rgba(255,255,255,0.96), rgba(226,232,240,0.85))",
                }}
              >
                {m.text}
              </div>
              <MessageActions text={m.text} onRetry={onRetry} />
            </AvaBubble>
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
          return <ToolCallChip key={key} label={humanizeTool(e.payload.tool, e.payload.args)} />;
        }
        if (e.kind === "tool_result") {
          // Success is already reflected live in the Activity panel and the
          // running line — keep the chat flow clean and only surface failures
          // inline (with the raw output tucked behind a click).
          if (e.payload.ok) return null;
          return <ToolCallChip key={key} label={humanizeTool(e.payload.tool)} ok={false} result={e.payload.result} />;
        }
        if (e.kind === "thought") {
          return null; // thoughts surface via the thinking caption, not rendered as message
        }
        if (e.kind === "error") {
          return <div key={key} className="text-sm text-red-400">error: {e.payload.message}</div>;
        }
        if (e.kind === "killed") {
          // Stop mid-stream must NOT discard the half-reply the user was reading.
          // The live StreamingReveal bubble unmounts once the run terminates, so
          // re-render the accumulated partial PLAINLY (no animation — the words
          // were already on screen) directly above the "stopped." chip. Guarded
          // on `!lastFinal` so a (rare) final + killed race never double-renders.
          const showPartial = streamingText.length > 0 && !lastFinal;
          return (
            <div key={key} className="space-y-3">
              {showPartial && (
                <div className="flex justify-start" data-testid="stopped-partial">
                  <AvaBubble reduced={reduced}>
                    <WordReveal
                      text={streamingText}
                      animate={false}
                      className="text-[15px] leading-[1.65] whitespace-pre-wrap"
                      gradient="linear-gradient(180deg, rgba(255,255,255,0.96), rgba(226,232,240,0.85))"
                    />
                  </AvaBubble>
                </div>
              )}
              <div className="text-sm text-amber-400">stopped.</div>
            </div>
          );
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

      {isStreaming && (
        <div className="flex justify-start" data-testid="streaming-message">
          <AvaBubble reduced={reduced}>
            <StreamingReveal
              text={streamingText}
              reduced={reduced}
              className="text-[15px] leading-[1.65] whitespace-pre-wrap"
              gradient="linear-gradient(180deg, rgba(255,255,255,0.96), rgba(226,232,240,0.85))"
            />
          </AvaBubble>
        </div>
      )}

      {lastFinal && (
        <div className="flex justify-start" data-testid="final-message">
          <AvaBubble reduced={reduced}>
            <WordReveal
              text={lastFinal.payload.text}
              // Animate unless the words were already revealed by a perceptibly-long
              // live stream (see the reveal-handoff timing above). Fixes the no-reveal
              // on fast reasoning-model bursts while avoiding a double reveal on slow ones.
              animate={animateFinal}
              className="text-[15px] leading-[1.65] whitespace-pre-wrap"
              gradient="linear-gradient(180deg, rgba(255,255,255,0.96), rgba(226,232,240,0.85))"
            />
            <MessageActions text={lastFinal.payload.text} onRetry={onRetry} />
          </AvaBubble>
        </div>
      )}

      {showThinking && (
        <div className="flex justify-start">
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
  );
}

/**
 * Owner (user) bubble — a distinct, brighter mercury surface so the speaker reads
 * as polished liquid metal vs Ava's cyan glass. Visually subordinate so the eye
 * rests on Ava's answers. Right-aligned, hover-lift, GSAP entrance via data-bubble.
 */
function OwnerBubble({ text, reduced }: { text: string; reduced: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      data-bubble
      onPointerEnter={() => ref.current && hoverLift(ref.current, true, reduced)}
      onPointerLeave={() => ref.current && hoverLift(ref.current, false, reduced)}
      className="lg-sweep group relative max-w-[78%] rounded-2xl rounded-br-md px-4 py-2.5 text-[14.5px] text-white/95"
      style={{
        background:
          "linear-gradient(135deg, rgba(214,238,244,0.16), rgba(159,198,212,0.05))",
        border: "1px solid rgba(159,198,212,0.28)",
        backdropFilter: "blur(18px) saturate(160%)",
        WebkitBackdropFilter: "blur(18px) saturate(160%)",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -1px 0 rgba(0,0,0,0.2), 0 10px 32px -12px rgba(0,0,0,0.6)",
      }}
    >
      <span className="relative z-[1]">{text}</span>
    </div>
  );
}

/**
 * Ava (assistant) bubble — a .lg-slab-derived cyan-tinted glass surface hosting the
 * text block + a static mercury Orb avatar. Hover-lift + specular sweep via lg-sweep.
 * The final-block orb here must NOT carry flipId (only ThinkingIndicator does).
 */
function AvaBubble({ children, reduced }: { children: React.ReactNode; reduced: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="flex items-start gap-3 max-w-[88%]">
      <div className="shrink-0 mt-1">
        <Orb state="idle" size={22} />
      </div>
      <div
        ref={ref}
        data-bubble
        onPointerEnter={() => ref.current && hoverLift(ref.current, true, reduced)}
        onPointerLeave={() => ref.current && hoverLift(ref.current, false, reduced)}
        className="lg-slab lg-sweep flex flex-col gap-2 px-4 py-3"
        style={{ boxShadow: SHADOW.rest }}
      >
        {children}
      </div>
    </div>
  );
}
