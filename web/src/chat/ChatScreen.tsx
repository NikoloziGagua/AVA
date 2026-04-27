import { useState } from "react";
import { api } from "../api.js";
import { MessageList, type ChatMessage } from "./MessageList.js";
import { Composer } from "./Composer.js";
import { useChatStream } from "./useChatStream.js";

export function ChatScreen() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [runEpoch, setRunEpoch] = useState(0);
  const { events } = useChatStream(sessionId, runEpoch);

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
      <header className="border-b border-neutral-800 p-3">
        <div className="text-lg font-semibold">Ava</div>
      </header>
      <MessageList history={history} liveEvents={events} />
      <Composer onSend={send} onKill={kill} busy={busy} />
    </div>
  );
}
