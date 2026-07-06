import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { api, fetchSession } from "../api.js";
import { MessageList, type ChatMessage } from "./MessageList.js";
import { Composer } from "./Composer.js";
import { useChatStream } from "./useChatStream.js";
import { FlowingLines } from "../components/ava/FlowingLines.js";
import { EdgeFade } from "../components/ava/EdgeFade.js";
import { ActivityPanel } from "./ActivityPanel.js";
import { deriveSteps, isExecuting, currentTool } from "./activity-steps.js";
import { isSmallScreen } from "../lib/media.js";

export interface ChatScreenProps {
  sessionId: string | null;
  /** When opening a fresh chat from the home command bar: auto-send this once. */
  initialText?: string;
  // Navigation now lives in the persistent TubelightNav (App.tsx). These props
  // are kept inert so the App.tsx call site doesn't need to change.
  onOpenSessions: () => void;
  onOpenRules: () => void;
  onOpenMemory: () => void;
  onOpenList?: () => void;
  onEnterVoice?: () => void;
}

export function ChatScreen({
  sessionId: requestedSessionId,
  initialText,
  onEnterVoice,
}: ChatScreenProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [runEpoch, setRunEpoch] = useState(0);
  const { events } = useChatStream(sessionId, runEpoch);
  const [seed] = useState<{ text: string; version: number }>({ text: "", version: 0 });
  // Synchronous optimistic-send flag: flips true the same frame send() fires,
  // BEFORE the awaited POST resolves — `busy` lags by the full round-trip, so
  // this is what makes the thinking indicator instant.
  const [pending, setPending] = useState(false);
  // Scroller node tracked BOTH as a ref (MessageList reads `.current`) and as
  // state (`scrollerNode`). FlowingLines' parallax ScrollTrigger depends on the
  // node *identity*; if the scroll element is replaced on session switch, the
  // stable ref object wouldn't trigger a re-init — the state node does.
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [scrollerNode, setScrollerNode] = useState<HTMLDivElement | null>(null);
  // Last assistant message in the SEEDED history. On reopen the server replays
  // the run's `final` on stream connect; for a finished run that text is already
  // the last persisted assistant message, so rendering/promoting the replay
  // would duplicate the final bubble. Captured once per fetch (the `s-` rows
  // never change), so the dedupe stays stable across later re-renders.
  const seededLastAssistantRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (requestedSessionId === null) {
      setSessionId(null);
      setHistory([]);
      setRunEpoch(0);
      seededLastAssistantRef.current = null;
      return;
    }
    fetchSession(requestedSessionId)
      .then((data) => {
        if (cancelled) return;
        const loaded: ChatMessage[] = data.messages.map((m) => ({
          id: `s-${m.id}`,
          role: m.role === "user" ? "user" : "assistant",
          text: m.content,
        }));
        seededLastAssistantRef.current =
          [...loaded].reverse().find((m) => m.role === "assistant")?.text ?? null;
        setHistory(loaded);
        setSessionId(requestedSessionId);
        setRunEpoch(0);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [requestedSessionId]);

  // Promote a completed run's final into history exactly once.
  // Bug fix: previously the lastFinal lived in `events` only; on the next
  // user turn it disappeared, making subsequent user messages stack
  // directly under the previous one with Ava's reply missing.
  useEffect(() => {
    const completedEpochs = new Set<number>();
    for (const e of events) {
      if (e.kind === "done" || e.kind === "killed" || e.kind === "error") {
        completedEpochs.add(e.runEpoch);
      }
    }
    if (completedEpochs.size === 0) return;
    setHistory((prev) => {
      let next = prev;
      for (const epoch of completedEpochs) {
        const id = `a-${epoch}`;
        if (next.some((m) => m.id === id)) continue;
        const final = [...events]
          .reverse()
          .find((e) => e.runEpoch === epoch && e.kind === "final");
        if (!final || final.kind !== "final") continue;
        // Epoch 0 only exists when REOPENING a chat (a local send always bumps
        // to ≥1), so its final is a server replay — skip it when it matches the
        // seeded history's last assistant message (already rendered there).
        // Locally-run epochs are never deduped, so an intentionally repeated
        // reply still shows.
        if (epoch === 0 && final.payload.text === seededLastAssistantRef.current) continue;
        next = [...next, { id, role: "assistant", text: final.payload.text }];
      }
      return next;
    });
  }, [events]);

  const currentRunFinished = events.some(
    (e) => e.runEpoch === runEpoch && (e.kind === "done" || e.kind === "killed" || e.kind === "error"),
  );
  // Busy is derived from the STREAM, not the local runEpoch counter: reopening
  // a chat resets runEpoch to 0, so the old `runEpoch > 0` gate made a reopened
  // MID-RUN chat read as idle — no Stop button, no thinking indicator, the run
  // streaming invisibly. An event seen for the current run without its terminal
  // event means the run is live; `pending` covers the send→first-event window.
  const currentRunSeen = events.some((e) => e.runEpoch === runEpoch);
  const streamBusy = currentRunSeen && !currentRunFinished;
  const busy = pending || streamBusy;
  const isEmpty = history.length === 0 && events.length === 0 && requestedSessionId === null;

  const headerState: "idle" | "thinking" | "responding" =
    busy
      ? events.some((e) => e.runEpoch === runEpoch && e.kind === "final")
        ? "responding"
        : "thinking"
      : "idle";

  // Filter live events: only current run, and skip its final once it's
  // been promoted into history (avoid duplicate rendering) — or when it's an
  // epoch-0 replay of the last persisted assistant message (same dedupe as the
  // promote effect above, so neither path renders the duplicate).
  const promotedCurrent = history.some((m) => m.id === `a-${runEpoch}`);
  const liveEvents = events.filter((e) => {
    if (e.runEpoch !== runEpoch) return false;
    if (e.kind === "final" && (promotedCurrent ||
        (e.runEpoch === 0 && e.payload.text === seededLastAssistantRef.current))) return false;
    return true;
  });

  // Activity / working-mode derivation from the live stream.
  const steps = deriveSteps(liveEvents);
  const executing = isExecuting(liveEvents);
  const runningTool = currentTool(liveEvents);

  // Optimistic thinking: instant on send (pending), held through busy, dropped
  // the moment the run's final lands or the run terminates. Pending hands off
  // to streamBusy (not `busy`, which pending itself feeds) once events arrive.
  const lastFinalCurrent = events.some((e) => e.runEpoch === runEpoch && e.kind === "final");
  useEffect(() => {
    if (streamBusy || currentRunFinished) setPending(false);
  }, [streamBusy, currentRunFinished]);
  const optimisticThinking = busy && !lastFinalCurrent && !currentRunFinished;

  const [activityCollapsed, setActivityCollapsed] = useState<boolean>(() => {
    // Small screens default to the collapsed edge tab — the docked panel would
    // crush the conversation column; the stored pref is a desktop choice.
    if (isSmallScreen()) return true;
    try { return localStorage.getItem("ava.activityCollapsed") === "1"; } catch { return false; }
  });
  function toggleActivity() {
    setActivityCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem("ava.activityCollapsed", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  }
  // Docked-rail flag (xl): when the Activity panel is expanded it sits as a
  // docked right rail, so (a) the composer indents to stay centered under the
  // conversation column and (b) MessageList hides the inline tool chips that
  // would duplicate the rail's step list. Both effects are xl-gated in CSS, so
  // nothing changes below xl.
  const railDocked = steps.length > 0 && !activityCollapsed;
  // Auto-expand the panel the moment a run starts doing things — desktop only;
  // on small screens the expanded panel overlays the conversation, so popping
  // it open uninvited would hide the chat mid-task.
  const wasExecutingRef = useRef(false);
  useEffect(() => {
    if (executing && !wasExecutingRef.current && !isSmallScreen()) setActivityCollapsed(false);
    wasExecutingRef.current = executing;
  }, [executing]);

  function retryLast() {
    const lastUser = [...history].reverse().find((m) => m.role === "user");
    if (lastUser) void send(lastUser.text);
  }

  async function send(text: string) {
    setHistory((prev) => [...prev, { role: "user", text, id: `u-${Date.now()}` }]);
    setPending(true); // optimistic — same frame as send, before the awaited POST
    const r = await api.sendMessage(sessionId, text);
    setSessionId(r.sessionId);
    setRunEpoch((n) => n + 1);
  }

  // Command bar on home opens a fresh chat with text to send — fire it exactly
  // once, only for a brand-new session.
  const autoSentRef = useRef(false);
  useEffect(() => {
    if (autoSentRef.current) return;
    const seedText = initialText?.trim();
    if (requestedSessionId === null && seedText) {
      autoSentRef.current = true;
      void send(seedText);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedSessionId, initialText]);

  async function kill() {
    if (!sessionId) return;
    await api.kill(sessionId);
  }

  return (
    <div className="relative flex h-full flex-col bg-black text-white">
      <FlowingLines charged={executing} scrollerRef={scrollerRef} scrollerNode={scrollerNode} />
      <div className="relative z-10 flex min-h-0 flex-1 flex-col pt-28">
        {/* Empty-state AVA — clears under the floating nav pill via pt-28. */}
        <AnimatePresence>
          {isEmpty && (
            <motion.div
              key="empty-ava"
              className="absolute inset-x-0 top-[14%] flex flex-col items-center pointer-events-none z-10"
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
            >
              <motion.div
                initial={{ opacity: 0, filter: "blur(20px)", y: 8 }}
                animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
                transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
                className="text-[10px] tracking-[0.45em] uppercase text-white/40 mb-3"
              >
                I AM
              </motion.div>
              <motion.div
                className="font-bold tracking-[0.20em] bg-clip-text text-transparent bg-gradient-to-b from-white via-white/85 to-white/40"
                style={{ fontSize: 96 }}
              >
                AVA
              </motion.div>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.6, delay: 0.6 }}
                className="mt-6 text-sm text-white/45 max-w-xs text-center px-6"
              >
                How can I help today? Type a message, tap a chip, or tap the orb to speak.
              </motion.p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* `relative` so the small-screen Activity overlay (absolute) pins to
            this row instead of taking layout width from the conversation. */}
        <div className="relative flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            {/* relative wrapper so the EdgeFade strips pin to the VISIBLE scroll
                edges (the viewport-height column), not the scroller's full
                content box. They sit OUTSIDE the scroll node as absolute,
                pointer-events-none siblings over it.
                lg: widen to a comfortable laptop reading column (860px) — the
                phone-width 760px read as a narrow strip on desktop. */}
            <div className="relative mx-auto flex min-h-0 w-full max-w-[760px] flex-1 flex-col lg:max-w-[860px]">
              <MessageList
                history={history}
                liveEvents={liveEvents}
                onRetry={retryLast}
                scrollerRef={scrollerRef}
                onScrollerMount={setScrollerNode}
                optimisticThinking={optimisticThinking}
                executing={executing}
                runningTool={runningTool}
                headerState={headerState}
                toolChipsDocked={railDocked}
              />
              <EdgeFade edge="top" />
              <EdgeFade edge="bottom" />
            </div>
          </div>
          {steps.length > 0 && (
            <ActivityPanel
              steps={steps}
              collapsed={activityCollapsed}
              onToggle={toggleActivity}
              executing={executing}
            />
          )}
        </div>
        {/* xl + docked rail: indent by the rail's occupied width (320px + mr-3)
            so the composer stays centered under the conversation column instead
            of centering on the viewport and sliding under the rail. */}
        <div className={railDocked ? "xl:mr-[332px] xl:transition-[margin] xl:duration-300" : "xl:transition-[margin] xl:duration-300"}>
          <Composer
            onSend={send}
            onKill={kill}
            onMicTap={() => onEnterVoice?.()}
            busy={busy}
            seed={seed}
          />
        </div>
      </div>
    </div>
  );
}
