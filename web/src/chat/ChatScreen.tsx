import { useEffect, useState } from "react";
import { api, fetchSession } from "../api.js";
import { MessageList, type ChatMessage } from "./MessageList.js";
import { Composer } from "./Composer.js";
import { useChatStream } from "./useChatStream.js";
import { Pulse } from "../components/ava/Pulse.js";
import { ChevronLeft, List, Brain, Settings2 } from "lucide-react";

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

  const currentRunFinished = events.some(
    (e) => e.runEpoch === runEpoch && (e.kind === "done" || e.kind === "killed" || e.kind === "error"),
  );
  const busy = runEpoch > 0 && !currentRunFinished;

  const headerState: "idle" | "thinking" | "responding" =
    busy
      ? events.some((e) => e.runEpoch === runEpoch && e.kind === "final")
        ? "responding"
        : "thinking"
      : "idle";

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
      className="relative flex flex-col h-full bg-black"
      style={{
        backgroundImage:
          "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(168,85,247,0.07), transparent 60%)",
      }}
    >
      <header className="relative z-10 flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.06] bg-black/55 backdrop-blur-xl h-14">
        <button
          onClick={onOpenSessions}
          aria-label="back to orbit"
          className="w-9 h-9 rounded-full text-white/65 hover:text-white hover:bg-white/8 active:scale-95 flex items-center justify-center transition-all"
        >
          <ChevronLeft size={18} />
        </button>

        <div className="flex-1 flex items-center gap-2 min-w-0">
          <Pulse state={headerState} size={12} />
          <div className="text-[13px] font-medium truncate text-white/85">{title}</div>
        </div>

        {/* Navbar — quick access to other surfaces */}
        <nav className="flex items-center gap-0.5 rounded-full border border-white/8 bg-white/[0.03] p-0.5 backdrop-blur-md">
          {onOpenList && (
            <button
              onClick={onOpenList}
              aria-label="all chats"
              className="w-8 h-8 rounded-full text-white/55 hover:text-white hover:bg-white/8 active:scale-95 flex items-center justify-center transition-all"
            >
              <List size={15} />
            </button>
          )}
          <button
            onClick={onOpenMemory}
            aria-label="memory"
            className="w-8 h-8 rounded-full text-white/55 hover:text-white hover:bg-white/8 active:scale-95 flex items-center justify-center transition-all"
          >
            <Brain size={15} />
          </button>
          <button
            onClick={onOpenRules}
            aria-label="rules"
            className="w-8 h-8 rounded-full text-white/55 hover:text-white hover:bg-white/8 active:scale-95 flex items-center justify-center transition-all"
          >
            <Settings2 size={15} />
          </button>
        </nav>
      </header>
      <div className="relative z-10 flex-1 flex flex-col">
        <MessageList history={history} liveEvents={events} />
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
