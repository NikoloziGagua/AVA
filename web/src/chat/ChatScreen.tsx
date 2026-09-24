import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { MessagesSquare } from "lucide-react";
import { api, fetchSession, ApiError, type SessionOrigin } from "../api.js";
import { isSessionUnavailable, mintBindingRequestId } from "./conversation-binding.js";
import { MessageList, type ChatMessage } from "./MessageList.js";
import { Composer } from "./Composer.js";
import { useChatStream } from "./useChatStream.js";
import { FlowingLines } from "../components/ava/FlowingLines.js";
import { EdgeFade } from "../components/ava/EdgeFade.js";
import { ActivityPanel } from "./ActivityPanel.js";
import { deriveSteps, isExecuting, currentTool } from "./activity-steps.js";
import { isSmallScreen } from "../lib/media.js";
import { fetchVisualExplanation } from "../visuals/api.js";
import type { VisualMessage, VisualMessageContext } from "../visuals/types.js";
import type { SavedItem } from "./saved-items.js";

export interface ChatScreenProps {
  sessionId: string | null;
  /** When opening a fresh chat from the home command bar: auto-send this once. */
  initialText?: string;
  // Navigation now lives in the persistent AppSidebar (App.tsx). These props
  // are kept inert so the App.tsx call site doesn't need to change.
  onOpenSessions: () => void;
  onOpenRules: () => void;
  onOpenMemory: () => void;
  onOpenList?: () => void;
  /** Continue this exact canonical conversation using speech input. */
  onEnterVoice?: (sessionId: string | null) => void;
  /**
   * Reports the conversation Nika is now in: after loading one she can talk in,
   * and after each accepted message. Never reported for automated runs.
   */
  onSessionChange?: (sessionId: string) => void;
  /** The exact conversation asked for is gone; the app stops remembering it. */
  onSessionUnavailable?: (sessionId: string) => void;
  /** Show this conversation for reference only (an automated run opened from Watches). */
  audit?: boolean;
  onNewChat?: () => void;
  onOpenStrategy?: (sessionId: string) => void;
  onOpenVisual?: (visualId: string) => void;
  /** Open something AVA saved during a reply (a Saved card row). */
  onOpenSaved?: (item: SavedItem) => void;
}

/**
 * The text of the most recent assistant message that follows the last user
 * message — the SAME rule the server replays on stream connect
 * (chat.ts `latestAssistantAfterLastUser`). Computed from the RAW server rows so
 * a trailing `system` recovery row (recovery.ts appends "Server restarted…")
 * can't poison the compare: the old code mapped `system`→assistant and took the
 * last such bubble, which never matched the server's strict-assistant replay and
 * duplicated the final on reopen.
 */
function latestAssistantAfterLastUser(
  messages: Array<{ role: string; content: string }>,
): string | null {
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "user") { lastUserIdx = i; break; }
  }
  for (let i = messages.length - 1; i > lastUserIdx; i--) {
    const m = messages[i]!;
    if (m.role === "assistant" && m.content.trim()) return m.content;
  }
  return null;
}

export function ChatScreen({
  sessionId: requestedSessionId,
  initialText,
  onEnterVoice,
  onSessionChange,
  onSessionUnavailable,
  audit = false,
  onNewChat,
  onOpenList,
  onOpenStrategy,
  onOpenSaved,
}: ChatScreenProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  // Creation provenance of the loaded conversation. Automated runs are shown
  // read-only; the server would refuse a human turn into them anyway.
  const [origin, setOrigin] = useState<SessionOrigin | undefined>(undefined);
  // The exact conversation asked for is gone. Nothing is switched silently.
  const [unavailable, setUnavailable] = useState(false);
  // One-time key for this screen's "new conversation", reused if the first
  // send is retried so a lost response can't create a second conversation.
  const newConversationKeyRef = useRef<string | null>(null);
  // A send answered after Nika navigated elsewhere must not steer the app:
  // late answers from an unmounted screen are dropped.
  const unmountedRef = useRef(false);
  useEffect(() => {
    unmountedRef.current = false;
    return () => { unmountedRef.current = true; };
  }, []);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [runEpoch, setRunEpoch] = useState(0);
  // The server's run id is also the diagnostic id carried by the receipt. Pass
  // it back on the SSE connection so a fast-finish replay cannot accidentally
  // surface an older receipt from the same conversation.
  const [taskId, setTaskId] = useState<string | null>(null);
  const [visualsByEpoch, setVisualsByEpoch] = useState<Record<number, VisualMessage[]>>({});
  const [attachedVisualContext, setAttachedVisualContext] = useState<VisualMessageContext | null>(null);
  // Reopen fetch failure (401 / network / deleted id). Non-null → render a
  // retry/error panel instead of a silent blank screen with a live composer.
  const [loadError, setLoadError] = useState<unknown>(null);
  // Bumped by the error panel's Retry to re-run the reopen fetch.
  const [reloadNonce, setReloadNonce] = useState(0);
  const { events } = useChatStream(sessionId, runEpoch, taskId);
  // Bumping the version puts text back into the composer (a rejected send's draft).
  const [seed, setSeed] = useState<{ text: string; version: number }>({ text: "", version: 0 });
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
  const openedRoomEventRef = useRef<string | null>(null);
  const loadedVisualEventRefs = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    if (requestedSessionId === null) {
      setSessionId(null);
      setHistory([]);
      setRunEpoch(0);
      setTaskId(null);
      setVisualsByEpoch({});
      setAttachedVisualContext(null);
      seededLastAssistantRef.current = null;
      return;
    }
    fetchSession(requestedSessionId)
      .then((data) => {
        if (cancelled) return;
        const loaded: ChatMessage[] = data.messages.map((m) => ({
          id: `s-${m.id}`,
          // `system` rows stay `system` (rendered as a notice) — collapsing them
          // into assistant bubbles both misattributed them to Ava AND broke the
          // reopen dedupe below.
          role: m.role === "user" ? "user" : m.role === "system" ? "system" : "assistant",
          text: m.content,
          ...(m.role === "user" && m.metadata?.inputSource === "voice_exact_text" ? { inputSource: "voice_exact_text" as const } : {}),
          ...(m.role === "user" && m.metadata?.visualContext ? { visualContext: m.metadata.visualContext } : {}),
          ...(m.role === "assistant" && m.visualMessages?.length ? { visualMessages: m.visualMessages } : {}),
          ...(m.role === "assistant" && m.metadata?.memoryContext ? { memoryContext: m.metadata.memoryContext } : {}),
          ...(m.role === "assistant" && m.metadata?.savedItems ? { savedItems: m.metadata.savedItems } : {}),
        }));
        // Dedupe target = server's replay rule over the RAW rows (not the last
        // mapped bubble), so a trailing `system` row can't shadow the real final.
        seededLastAssistantRef.current = latestAssistantAfterLastUser(data.messages);
        setHistory(loaded);
        setSessionId(requestedSessionId);
        setOrigin(data.session.origin);
        setUnavailable(false);
        // Explicitly opening a conversation selects it, older unclassified ones
        // included. Automated runs, and anything opened for reference, never
        // become the conversation Chat and Voice continue.
        if (!audit && data.session.origin !== "automation") onSessionChange?.(requestedSessionId);
        setRunEpoch(0);
        setTaskId(null);
        setVisualsByEpoch({});
        setAttachedVisualContext(null);
      })
      .catch((e) => {
        if (cancelled) return;
        if (isSessionUnavailable(e)) {
          setUnavailable(true);
          onSessionUnavailable?.(requestedSessionId);
          return;
        }
        // 401 is already centralized in api.ts (clearToken + ava:unauthorized →
        // App routes to pairing); here we just surface a panel so the screen is
        // never a silent dead blank.
        setLoadError(e);
      });
    return () => { cancelled = true; };
  }, [audit, onSessionChange, onSessionUnavailable, requestedSessionId, reloadNonce]);

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
        const inlineVisuals = visualsByEpoch[epoch] ?? [];
        const memoryContext = [...events]
          .reverse()
          .find((event) => event.runEpoch === epoch && event.kind === "memory_context");
        const savedItems = [...events]
          .reverse()
          .find((event) => event.runEpoch === epoch && event.kind === "saved_items");
        const existingIndex = next.findIndex((m) => m.id === id);
        if (existingIndex >= 0) {
          const existing = next[existingIndex];
          if (existing?.role === "assistant" &&
              ((inlineVisuals.length && existing.visualMessages !== inlineVisuals) ||
               (memoryContext?.kind === "memory_context" && existing.memoryContext !== memoryContext.payload) ||
               (savedItems?.kind === "saved_items" && existing.savedItems !== savedItems.payload))) {
            next = next.map((message, index) => index === existingIndex ? {
              ...existing,
              ...(inlineVisuals.length ? { visualMessages: inlineVisuals } : {}),
              ...(memoryContext?.kind === "memory_context" ? { memoryContext: memoryContext.payload } : {}),
              ...(savedItems?.kind === "saved_items" ? { savedItems: savedItems.payload } : {}),
            } : message);
          }
          continue;
        }
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
        next = [...next, {
          id,
          role: "assistant",
          text: final.payload.text,
          ...(inlineVisuals.length ? { visualMessages: inlineVisuals } : {}),
          ...(memoryContext?.kind === "memory_context" ? { memoryContext: memoryContext.payload } : {}),
          ...(savedItems?.kind === "saved_items" ? { savedItems: savedItems.payload } : {}),
        }];
      }
      return next;
    });
  }, [events, visualsByEpoch]);

  // A natural-language "take this to the Room" request calls the same
  // server-authoritative tool as the manual shortcut. Move only after its
  // successful tool result is observed, and only once for that event.
  useEffect(() => {
    if (!sessionId || !onOpenStrategy) return;
    const opened = [...events].reverse().find((event) =>
      event.kind === "tool_result" &&
      event.payload.tool === "strategy_room_open" &&
      event.payload.ok,
    );
    if (!opened) return;
    const key = `${opened.runEpoch}-${opened.id}`;
    if (openedRoomEventRef.current === key) return;
    openedRoomEventRef.current = key;
    onOpenStrategy(sessionId);
  }, [events, onOpenStrategy, sessionId]);

  // A successful visual tool result carries the exact server-issued revision.
  // Resolve it into the assistant message rather than navigating away. Repeated
  // SSE delivery is idempotent by event key and visual id/revision.
  useEffect(() => {
    const created = events.filter((event) =>
      event.kind === "tool_result" &&
      (event.payload.tool === "visual_explanation_create" || event.payload.tool === "research_visual_create") &&
      event.payload.ok,
    );
    for (const event of created) {
      if (event.kind !== "tool_result") continue;
      const key = `${event.runEpoch}-${event.id}`;
      if (loadedVisualEventRefs.current.has(key)) continue;
      let visualId = "";
      let revision: number | undefined;
      try {
        const parsed = JSON.parse(event.payload.result) as {
          visualMessageId?: unknown;
          visualExplanationId?: unknown;
          revision?: unknown;
        };
        visualId = typeof parsed.visualMessageId === "string"
          ? parsed.visualMessageId
          : typeof parsed.visualExplanationId === "string" ? parsed.visualExplanationId : "";
        if (typeof parsed.revision === "number" && Number.isInteger(parsed.revision)) revision = parsed.revision;
      } catch { continue; }
      if (!/^visual_[A-Za-z0-9_-]{8,32}$/.test(visualId)) continue;
      loadedVisualEventRefs.current.add(key);
      void fetchVisualExplanation(visualId, revision)
        .then((visual) => setVisualsByEpoch((current) => {
          const existing = current[event.runEpoch] ?? [];
          if (existing.some((item) => item.visualMessageId === visual.visualMessageId && item.revision === visual.revision)) return current;
          return { ...current, [event.runEpoch]: [...existing, visual] };
        }))
        .catch(() => { loadedVisualEventRefs.current.delete(key); });
    }
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
  const isEmpty = history.length === 0 && events.length === 0 && requestedSessionId === null && !unavailable;
  // Automated runs are evidence to read, not a conversation to continue.
  const readOnly = audit || origin === "automation";

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
  const seededAssistant = [...history].reverse().find((message) => message.role === "assistant");
  const liveEvents = events.filter((e) => {
    if (e.runEpoch !== runEpoch) return false;
    if (e.kind === "final" && (promotedCurrent ||
        (e.runEpoch === 0 && e.payload.text === seededLastAssistantRef.current))) return false;
    if (e.kind === "memory_context" && (promotedCurrent ||
        (e.runEpoch === 0 && seededAssistant?.role === "assistant" && seededAssistant.memoryContext))) return false;
    if (e.kind === "saved_items" && (promotedCurrent ||
        (e.runEpoch === 0 && seededAssistant?.role === "assistant" && seededAssistant.savedItems))) return false;
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
    if (lastUser) void send(lastUser.text, lastUser.visualContext);
  }

  async function send(text: string, explicitVisualContext?: VisualMessageContext) {
    const visualContext = explicitVisualContext ?? attachedVisualContext ?? undefined;
    const optimisticId = `u-${Date.now()}`;
    setHistory((prev) => [...prev, {
      role: "user",
      text,
      id: optimisticId,
      ...(visualContext ? { visualContext } : {}),
    }]);
    setPending(true); // optimistic — same frame as send, before the awaited POST
    // While a reopened conversation is still loading, the requested id is
    // already canonical; never let a quick send turn it into a new conversation.
    const current = sessionId ?? requestedSessionId;
    if (!current && !newConversationKeyRef.current) newConversationKeyRef.current = mintBindingRequestId();
    try {
      const r = await api.sendMessage(current, text, {
        visualContext,
        conversationIntent: current ? "resume" : "new",
        ...(current ? {} : { bindingRequestId: newConversationKeyRef.current! }),
      });
      if (unmountedRef.current) return;
      const bound = r.binding?.sessionId ?? r.sessionId;
      newConversationKeyRef.current = null;
      setSessionId(bound);
      if (r.binding?.origin) setOrigin(r.binding.origin);
      onSessionChange?.(bound);
      setTaskId(r.taskId ?? null);
      setRunEpoch((n) => n + 1);
      if (visualContext && attachedVisualContext === visualContext) setAttachedVisualContext(null);
    } catch (e) {
      if (unmountedRef.current) return;
      if (isSessionUnavailable(e)) {
        // The conversation is gone: give the words back instead of losing them,
        // and let Nika choose where they go.
        setPending(false);
        setHistory((prev) => prev.filter((message) => message.id !== optimisticId));
        setSeed((prev) => ({ text, version: prev.version + 1 }));
        setUnavailable(true);
        if (current) onSessionUnavailable?.(current);
        return;
      }
      // A failed POST (401 / offline / 5xx / 409) must NOT strand the chat: drop
      // the optimistic thinking flag (no events will ever arrive to clear it) and
      // append a visible assistant error bubble. It becomes the last assistant
      // message, so MessageActions offers Retry (retryLast re-sends this turn).
      // 401 is centrally handled in api.ts (clearToken + ava:unauthorized).
      setPending(false);
      const is401 = e instanceof ApiError && e.status === 401;
      const isMissingProvider =
        e instanceof ApiError &&
        e.status === 503 &&
        e.message === "no_llm_provider";
      setHistory((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "assistant",
          text: is401
            ? "Session expired — re-pair this device to continue."
            : isMissingProvider
              ? "AVA is running, but no AI provider is configured. Add OPENAI_API_KEY or ANTHROPIC_API_KEY to AVA's .env file, then restart AVA."
              : e instanceof ApiError && e.code === "stale_visual_revision"
                ? "That visual changed before the context was sent. Reopen its newest revision and try again."
                : "That didn't send, Sir. Tap retry to try again.",
        },
      ]);
    }
  }

  function handleVisualSemanticAction(context: VisualMessageContext, visual: VisualMessage) {
    if (context.action === "attach") {
      setAttachedVisualContext(context);
      return;
    }
    const text = context.action === "branch"
      ? `Explain the selected branch of “${visual.title}” and what it means for the next decision.`
      : `Explain this scene of “${visual.title}” in more detail.`;
    void send(text, context);
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
    await api.killAll(sessionId);
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
                // Compositor-only reveal (opacity + translateY) — animating
                // filter:blur here forced a full-quality per-frame raster.
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
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
              {unavailable ? (
                <div role="alert" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
                  <div className="text-sm font-medium text-white/85">This conversation is unavailable.</div>
                  <div className="max-w-sm text-xs leading-relaxed text-white/60">
                    It may have been deleted. Your message is still in the box below; start a new
                    conversation or pick one of yours.
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    {onNewChat && (
                      <button type="button" onClick={onNewChat} className="btn-deck btn-primary">
                        Start a new conversation
                      </button>
                    )}
                    {onOpenList && (
                      <button type="button" onClick={onOpenList} className="btn-deck btn-ghost">
                        Your conversations
                      </button>
                    )}
                  </div>
                </div>
              ) : loadError ? (
                <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
                  <div className="max-w-sm text-sm leading-relaxed text-white/70">
                    {loadError instanceof ApiError && loadError.status === 401
                      ? "Session expired — re-pair this device to continue."
                      : "Couldn't load this conversation, Sir. Check your connection and try again."}
                  </div>
                  {!(loadError instanceof ApiError && loadError.status === 401) && (
                    <button
                      onClick={() => setReloadNonce((n) => n + 1)}
                      className="btn-deck btn-primary"
                    >
                      Retry
                    </button>
                  )}
                </div>
              ) : (
                <>
                  {sessionId && history.length > 0 && onOpenStrategy && (
                    <div className="flex justify-end px-4 pb-1 lg:px-6">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => onOpenStrategy(sessionId)}
                        title="Bring this conversation into the Strategy Room with AVA and Codex"
                        className="btn-deck btn-ghost flex items-center gap-2 disabled:opacity-40"
                      >
                        <MessagesSquare size={13} /> Take to Room
                      </button>
                    </div>
                  )}
                  <MessageList
                    history={history}
                    liveEvents={liveEvents}
                    onRetry={retryLast}
                    onOpenSaved={onOpenSaved}
                    scrollerRef={scrollerRef}
                    onScrollerMount={setScrollerNode}
                    optimisticThinking={optimisticThinking}
                    executing={executing}
                    runningTool={runningTool}
                    headerState={headerState}
                    toolChipsDocked={railDocked}
                    onVisualSemanticAction={handleVisualSemanticAction}
                  />
                  <EdgeFade edge="top" />
                  <EdgeFade edge="bottom" />
                </>
              )}
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
        {/* xl + docked rail: shift the composer left so it stays centered under
            the conversation column (the rail occupies ~332px on the right).
            translateX (compositor-only) instead of animating margin, which would
            reflow the whole conversation column every frame. Half the rail width
            (~166px) matches the recentering the old mr-[332px] produced. */}
        <div
          className={`xl:transition-transform xl:duration-300 ${railDocked ? "xl:-translate-x-[166px]" : "xl:translate-x-0"}`}
        >
          {attachedVisualContext && (
            <div className="mx-auto mb-2 flex w-[calc(100%-2rem)] max-w-[760px] items-center justify-between gap-3 rounded-xl border border-cyan-300/20 bg-cyan-300/[0.07] px-3 py-2 text-xs text-cyan-50/75 lg:max-w-[860px]" role="status">
              <span>Selected visual context attached · revision {attachedVisualContext.revision} · {attachedVisualContext.selectedElementIds.length} element{attachedVisualContext.selectedElementIds.length === 1 ? "" : "s"}</span>
              <button type="button" onClick={() => setAttachedVisualContext(null)} className="text-white/45 hover:text-white" aria-label="Remove attached visual context">Remove</button>
            </div>
          )}
          {readOnly ? (
            <div
              role="note"
              className="mx-auto mb-4 flex w-[calc(100%-2rem)] max-w-[760px] flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-xs leading-5 text-white/65 lg:max-w-[860px]"
            >
              <span>This is an automated run AVA did on its own, shown for reference. It never becomes your current chat.</span>
              {onNewChat && (
                <button type="button" onClick={onNewChat} className="btn-deck btn-ghost">
                  Start a new conversation
                </button>
              )}
            </div>
          ) : (
            <Composer
              onSend={(text) => { void send(text); }}
              onKill={kill}
              // Reopening a persisted chat hydrates its local state asynchronously.
              // During that short window the requested ID is already canonical;
              // never turn it into null and accidentally invoke fresh-voice policy.
              onMicTap={() => onEnterVoice?.(sessionId ?? requestedSessionId)}
              busy={busy}
              seed={seed}
            />
          )}
        </div>
      </div>
    </div>
  );
}
