import { useEffect, useState } from "react";
import { api, fetchSession } from "../api.js";
import { MessageList, type ChatMessage } from "./MessageList.js";
import { Composer } from "./Composer.js";
import { useChatStream } from "./useChatStream.js";
import { enablePush } from "../push/register.js";
import { QuickChips } from "./QuickChips.js";

export function ChatScreen({
  sessionId: requestedSessionId,
  onOpenSessions,
  onOpenRules,
}: {
  sessionId: string | null;
  onOpenSessions: () => void;
  onOpenRules: () => void;
}) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [runEpoch, setRunEpoch] = useState(0);
  const { events } = useChatStream(sessionId, runEpoch);
  const [pushState, setPushState] = useState<"idle" | "pending" | "ok" | string>(
    typeof Notification !== "undefined" && Notification.permission === "granted" ? "ok" : "idle",
  );
  const [seed, setSeed] = useState<{ text: string; version: number }>({ text: "", version: 0 });

  useEffect(() => {
    let cancelled = false;
    if (requestedSessionId === null) {
      // New chat: clear state.
      setSessionId(null);
      setHistory([]);
      setRunEpoch(0);
      return;
    }
    if (requestedSessionId === sessionId) return;
    // Load the requested session's history.
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
      })
      .catch(() => {
        // best-effort; leave UI as-is
      });
    return () => {
      cancelled = true;
    };
  }, [requestedSessionId]);

  const currentRunFinished = events.some(
    (e) => e.runEpoch === runEpoch && (e.kind === "done" || e.kind === "killed" || e.kind === "error")
  );
  const busy = runEpoch > 0 && !currentRunFinished;

  async function send(text: string) {
    const userMsg: ChatMessage = {
      role: "user",
      text,
      id: `u-${Date.now()}`,
    };
    setHistory((prev) => [...prev, userMsg]);
    const r = await api.sendMessage(sessionId, text);
    setSessionId(r.sessionId);
    setRunEpoch((n) => n + 1);
  }

  async function kill() {
    if (!sessionId) return;
    await api.kill(sessionId);
  }

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between border-b border-neutral-800 p-3">
        <button
          onClick={onOpenSessions}
          aria-label="open sessions"
          className="text-neutral-400 text-lg px-2"
        >
          ☰
        </button>
        <div className="text-lg font-semibold">Ava</div>
        <div className="flex items-center gap-1">
          {pushState !== "ok" ? (
            <button
              disabled={pushState === "pending"}
              onClick={async () => {
                setPushState("pending");
                const r = await enablePush("phone");
                setPushState(r.ok ? "ok" : r.reason);
                if (!r.ok) setTimeout(() => setPushState("idle"), 5000);
              }}
              className="text-xs text-emerald-400 px-2 disabled:opacity-50"
            >
              {pushState === "pending"
                ? "enabling..."
                : pushState === "idle"
                  ? "enable notifications"
                  : pushState}
            </button>
          ) : null}
          <button onClick={onOpenRules} aria-label="rules" className="text-neutral-400 text-lg px-2">⚙</button>
        </div>
      </header>
      <MessageList history={history} liveEvents={events} />
      <QuickChips
        refreshKey={runEpoch}
        onTap={(prompt) => setSeed({ text: prompt, version: Date.now() })}
      />
      <Composer onSend={send} onKill={kill} busy={busy} seed={seed} />
    </div>
  );
}
