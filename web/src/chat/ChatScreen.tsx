import { useState } from "react";
import { api } from "../api.js";
import { MessageList, type ChatMessage } from "./MessageList.js";
import { Composer } from "./Composer.js";
import { useChatStream } from "./useChatStream.js";

export function ChatScreen() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const { events } = useChatStream(sessionId);

  const busy = !events.some((e) => e.kind === "done" || e.kind === "killed" || e.kind === "error");

  async function send(text: string) {
    const userMsg: ChatMessage = {
      role: "user",
      text,
      id: `u-${Date.now()}`,
    };
    setHistory((prev) => [...prev, userMsg]);
    const r = await api.sendMessage(sessionId, text);
    setSessionId(r.sessionId);
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
      <Composer onSend={send} onKill={kill} busy={!!sessionId && busy && events.length > 0} />
    </div>
  );
}
