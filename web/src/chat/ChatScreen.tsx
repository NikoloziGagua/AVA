import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { api, fetchSession } from "../api.js";
import { MessageList, type ChatMessage } from "./MessageList.js";
import { Composer } from "./Composer.js";
import { useChatStream } from "./useChatStream.js";
import { Pulse } from "../components/ava/Pulse.js";
import { ChevronLeft, List, Brain, Settings2 } from "lucide-react";
import { useGsapReveal } from "../lib/useGsapReveal.js";

export interface ChatScreenProps {
  sessionId: string | null;
  onOpenSessions: () => void;
  onOpenRules: () => void;
  onOpenMemory: () => void;
  onOpenList?: () => void;
  onEnterVoice?: () => void;
}

export function ChatScreen({
  sessionId: requestedSessionId,
  onOpenSessions,
  onOpenRules,
  onOpenMemory,
  onOpenList,
  onEnterVoice,
}: ChatScreenProps) {
  const shellRef = useGsapReveal([requestedSessionId ?? "new"]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [runEpoch, setRunEpoch] = useState(0);
  const { events } = useChatStream(sessionId, runEpoch);
  const [seed] = useState<{ text: string; version: number }>({ text: "", version: 0 });
  const [title, setTitle] = useState<string>("New chat");

  useEffect(() => {
    let cancelled = false;
    if (requestedSessionId === null) {
      setSessionId(null);
      setHistory([]);
      setRunEpoch(0);
      setTitle("New chat");
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
        setHistory(loaded);
        setSessionId(requestedSessionId);
        setRunEpoch(0);
        setTitle(data.session.title ?? "Untitled");
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
        next = [...next, { id, role: "assistant", text: final.payload.text }];
      }
      return next;
    });
  }, [events]);

  const currentRunFinished = events.some(
    (e) => e.runEpoch === runEpoch && (e.kind === "done" || e.kind === "killed" || e.kind === "error"),
  );
  const busy = runEpoch > 0 && !currentRunFinished;
  const isEmpty = history.length === 0 && events.length === 0 && requestedSessionId === null;

  const headerState: "idle" | "thinking" | "responding" =
    busy
      ? events.some((e) => e.runEpoch === runEpoch && e.kind === "final")
        ? "responding"
        : "thinking"
      : "idle";

  // Filter live events: only current run, and skip its final once it's
  // been promoted into history (avoid duplicate rendering).
  const promotedCurrent = history.some((m) => m.id === `a-${runEpoch}`);
  const liveEvents = events.filter((e) => {
    if (e.runEpoch !== runEpoch) return false;
    if (promotedCurrent && e.kind === "final") return false;
    return true;
  });

  async function send(text: string) {
    setHistory((prev) => [...prev, { role: "user", text, id: `u-${Date.now()}` }]);
    const r = await api.sendMessage(sessionId, text);
    setSessionId(r.sessionId);
    setRunEpoch((n) => n + 1);
  }

  async function kill() {
    if (!sessionId) return;
    await api.kill(sessionId);
  }

  return (
    <div
      ref={shellRef}
      className="ava-luxe-screen relative flex flex-col text-white"
    >
      <header
        data-gsap-reveal
        className="ava-luxe-header relative"
      >
        <button
          onClick={onOpenSessions}
          aria-label="back to orbit"
          className="ava-icon-button shrink-0"
        >
          <ChevronLeft size={20} />
        </button>

        <div className="flex-1 flex items-center gap-3 min-w-0">
          {/* AVA wordmark — morphs from centered empty state when first message lands */}
          <AnimatePresence mode="wait">
            {!isEmpty && (
              <motion.div
                key="navbar-ava"
                layoutId="chat-ava-wordmark"
                className="ava-metal-wordmark font-semibold tracking-[0.22em]"
                style={{ fontSize: 18 }}
                transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              >
                AVA
              </motion.div>
            )}
          </AnimatePresence>
          {!isEmpty && (
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-1.5">
                <Pulse state={headerState} size={9} />
                <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--ava-fg-faint)]">
                  {headerState === "thinking" ? "thinking" : headerState === "responding" ? "responding" : "ready"}
                </div>
              </div>
              <div className="text-[12px] truncate text-[var(--ava-fg-muted)]">{title}</div>
            </div>
          )}
        </div>

        <nav className="ava-mini-nav">
          {onOpenList && (
            <button
              onClick={onOpenList}
              aria-label="all chats"
              className="ava-icon-button"
            >
              <List size={16} />
            </button>
          )}
          <button
            onClick={onOpenMemory}
            aria-label="memory"
            className="ava-icon-button"
          >
            <Brain size={16} />
          </button>
          <button
            onClick={onOpenRules}
            aria-label="rules"
            className="ava-icon-button"
          >
            <Settings2 size={16} />
          </button>
        </nav>
      </header>
      <div className="relative z-10 flex-1 flex flex-col">
        {/* Empty-state AVA — sits in the message area, morphs into the navbar wordmark when first message arrives */}
        <AnimatePresence>
          {isEmpty && (
            <motion.div
              key="empty-ava"
              data-gsap-reveal
              className="absolute inset-x-0 top-[14%] flex flex-col items-center pointer-events-none z-10 px-6"
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
            >
              <motion.div
                initial={{ opacity: 0, filter: "blur(20px)", y: 8 }}
                animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
                transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
                className="ava-kicker mb-3"
              >
                private line
              </motion.div>
              <motion.div
                layoutId="chat-ava-wordmark"
                className="ava-metal-wordmark font-semibold tracking-[0.20em]"
                style={{ fontSize: 96 }}
                transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              >
                AVA
              </motion.div>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.6, delay: 0.6 }}
                className="mt-6 max-w-xs text-center text-sm leading-6 text-[var(--ava-fg-muted)]"
              >
                Ready for signal, context, and decisions.
              </motion.p>
            </motion.div>
          )}
        </AnimatePresence>

        <MessageList history={history} liveEvents={liveEvents} />
        <Composer
          onSend={send}
          onKill={kill}
          onMicTap={() => onEnterVoice?.()}
          busy={busy}
          seed={seed}
        />
      </div>
    </div>
  );
}
