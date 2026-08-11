import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Bot,
  Check,
  CirclePause,
  CirclePlay,
  Code2,
  MessageSquarePlus,
  MessagesSquare,
  Send,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { ApiError } from "../api.js";
import { PanelSection, PanelShell } from "../components/ava/PanelShell.js";
import {
  approveStrategyRoom,
  createStrategyRoom,
  createStrategyRoomFromChat,
  fetchStrategyMeta,
  fetchStrategyRoom,
  fetchStrategyRooms,
  pauseStrategyRoom,
  resumeStrategyRoom,
  returnStrategyConclusionToChat,
  sendStrategyMessage,
  subscribeStrategyEvents,
  type StrategyActor,
  type StrategyDetail,
  type StrategyMessage,
  type StrategyMeta,
  type StrategyRoom,
} from "./api.js";

type StreamState = "connecting" | "live" | "offline";

const ACTOR = {
  niko: { label: "Niko", icon: UserRound, color: "#5cf2ff" },
  ava: { label: "AVA", icon: Bot, color: "#bb8cff" },
  codex: { label: "Codex", icon: Code2, color: "#f6c76c" },
  system: { label: "System", icon: ShieldCheck, color: "#94a3b8" },
} as const;

function roomStatus(room: StrategyRoom): string {
  if (room.status === "awaiting_niko") return "YOUR REVIEW";
  return room.status.replaceAll("_", " ").toUpperCase();
}

function participantStatus(actor: "niko" | "ava" | "codex", room: StrategyRoom | null, meta: StrategyMeta | null): string {
  if (!meta?.participants[actor].available) return "unavailable";
  if (!room) return "ready";
  if (room.activeActor === actor) return actor === "niko" ? "adding context" : "responding";
  if (actor === "niko" && room.status === "awaiting_niko") return "your turn";
  if (room.status === "approved") return "decision recorded";
  if (room.status === "paused") return "paused";
  return "listening";
}

function Brief({ text }: { text: string | null }) {
  if (!text) {
    return <p className="text-xs leading-6 text-white/40">The living brief will form as AVA and Codex compare positions.</p>;
  }
  return (
    <div className="space-y-2 text-[12px] leading-5 text-white/70">
      {text.split("\n").map((line, index) => line.startsWith("# ")
        ? <h3 key={index} className="hud pt-2 text-[10px] tracking-[0.15em] text-[var(--ac)]">{line.slice(2)}</h3>
        : line.trim()
          ? <p key={index}>{line.replace(/^[-*]\s+/, "• ")}</p>
          : <div key={index} className="h-1" />)}
    </div>
  );
}

function MessageCard({ message }: { message: StrategyMessage }) {
  const look = ACTOR[message.author];
  const Icon = look.icon;
  return (
    <article className="rounded-xl border border-white/[0.07] bg-black/35 px-4 py-3.5">
      <header className="mb-2 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-[11px] font-semibold" style={{ color: look.color }}>
          <span className="flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-white/[0.04]">
            <Icon size={13} />
          </span>
          {look.label}
        </span>
        <span className="hud text-[8px] tracking-[0.14em] text-white/30">{message.kind}</span>
      </header>
      <div className="whitespace-pre-wrap break-words text-[13px] leading-6 text-white/78">{message.content}</div>
    </article>
  );
}

export type StrategyRoomScreenProps = {
  sourceSessionId?: string | null;
  onOpenChat?: (sessionId: string) => void;
};

export function StrategyRoomScreen({ sourceSessionId = null, onOpenChat }: StrategyRoomScreenProps = {}) {
  const [rooms, setRooms] = useState<StrategyRoom[]>([]);
  const [detail, setDetail] = useState<StrategyDetail | null>(null);
  const [meta, setMeta] = useState<StrategyMeta | null>(null);
  const [stream, setStream] = useState<StreamState>("connecting");
  const [topic, setTopic] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const selectedIdRef = useRef<string | null>(null);
  const reloadTimer = useRef<number | null>(null);
  const importedSourceRef = useRef<string | null>(null);

  const selectRoom = async (id: string) => {
    selectedIdRef.current = id;
    setError(null);
    try { setDetail(await fetchStrategyRoom(id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not open the room."); }
  };

  const refreshRooms = async () => {
    const next = await fetchStrategyRooms();
    setRooms(next);
    if (!selectedIdRef.current && next[0]) await selectRoom(next[0].id);
  };

  useEffect(() => {
    let alive = true;
    void Promise.all([fetchStrategyMeta(), fetchStrategyRooms()]).then(async ([nextMeta, nextRooms]) => {
      if (!alive) return;
      setMeta(nextMeta);
      setRooms(nextRooms);
      if (sourceSessionId && importedSourceRef.current !== sourceSessionId) {
        importedSourceRef.current = sourceSessionId;
        const linked = await createStrategyRoomFromChat(sourceSessionId);
        if (!alive) return;
        selectedIdRef.current = linked.room.id;
        setDetail(linked);
        setRooms((current) => [linked.room, ...current.filter((room) => room.id !== linked.room.id)]);
      } else if (nextRooms[0]) await selectRoom(nextRooms[0].id);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Strategy Room is unavailable."));
    const unsubscribe = subscribeStrategyEvents({
      onState: (state) => { if (alive) setStream(state); },
      onGap: () => { if (alive) void refreshRooms(); },
      onEvent: (event) => {
        if (!alive) return;
        if (reloadTimer.current !== null) window.clearTimeout(reloadTimer.current);
        reloadTimer.current = window.setTimeout(() => {
          void refreshRooms();
          if (selectedIdRef.current === event.roomId) void selectRoom(event.roomId);
        }, 90);
      },
    });
    return () => {
      alive = false;
      unsubscribe();
      if (reloadTimer.current !== null) window.clearTimeout(reloadTimer.current);
    };
  }, [sourceSessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }, [detail?.messages.length]);

  const activeRoom = detail?.room ?? null;
  const codexSession = useMemo(
    () => activeRoom?.codexThreadId ? activeRoom.codexThreadId.slice(0, 12) : null,
    [activeRoom?.codexThreadId],
  );

  const runAction = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refreshRooms();
      if (selectedIdRef.current) await selectRoom(selectedIdRef.current);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The action failed.";
      setError(cause instanceof ApiError && cause.code === "stale_version"
        ? "The room changed in another event. It has been refreshed; try the action again."
        : message);
      if (selectedIdRef.current) void selectRoom(selectedIdRef.current);
    } finally { setBusy(false); }
  };

  const createRoom = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = topic.trim();
    if (!value || busy) return;
    await runAction(async () => {
      const created = await createStrategyRoom(value);
      selectedIdRef.current = created.room.id;
      setDetail(created);
      setTopic("");
    });
  };

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const room = activeRoom;
    const value = draft.trim();
    if (!room || !value || busy) return;
    await runAction(async () => {
      setDetail(await sendStrategyMessage(room.id, value));
      setDraft("");
    });
  };

  const returnToChat = async () => {
    const room = activeRoom;
    if (!room || !room.sourceSessionId || busy) return;
    if (room.returnedMessageId !== null) {
      onOpenChat?.(room.sourceSessionId);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const returned = await returnStrategyConclusionToChat(room.id, room.version);
      setDetail((current) => current ? { ...current, room: returned.room } : current);
      onOpenChat?.(returned.sessionId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The conclusion could not be returned to chat.");
      void selectRoom(room.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <PanelShell title="Strategy Room" grid>
      <PanelSection
        title="Rooms"
        span="lg:col-span-3"
        right={<span className={`chip ${stream === "live" ? "chip-live" : stream === "offline" ? "chip-stop" : "chip-exec"}`}>{stream}</span>}
      >
        <form onSubmit={createRoom} className="space-y-2">
          <textarea
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            aria-label="New strategy topic"
            placeholder="What should the team think through?"
            rows={3}
            className="w-full resize-none rounded-xl border border-white/10 bg-black/35 px-3 py-2.5 text-xs leading-5 outline-none placeholder:text-white/30 focus:border-[rgba(92,242,255,.4)]"
          />
          <button disabled={busy || !topic.trim()} className="btn-deck btn-primary flex w-full items-center justify-center gap-2 disabled:opacity-40">
            <MessageSquarePlus size={13} /> Start room
          </button>
        </form>
        <div className="mt-5 space-y-2 border-t border-white/[0.07] pt-4">
          {rooms.length === 0 && <p className="text-xs text-white/35">No rooms yet.</p>}
          {rooms.map((room) => (
            <button
              key={room.id}
              onClick={() => void selectRoom(room.id)}
              className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${activeRoom?.id === room.id ? "border-[rgba(92,242,255,.3)] bg-[rgba(92,242,255,.07)]" : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05]"}`}
            >
              <div className="line-clamp-2 text-[12px] leading-5 text-white/75">{room.title}</div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="hud text-[8px] text-white/30">ROUND {room.round}</span>
                <span className="hud text-[8px]" style={{ color: room.status === "approved" ? "var(--ac-live)" : room.status === "failed" ? "var(--ac-stop)" : "var(--ac)" }}>{roomStatus(room)}</span>
              </div>
            </button>
          ))}
        </div>
      </PanelSection>

      <PanelSection
        title={activeRoom?.title ?? "Discussion"}
        span="lg:col-span-6"
        right={activeRoom ? <span className="chip chip-ac">{activeRoom.phase.replaceAll("_", " ")}</span> : undefined}
      >
        {!detail ? (
          <div className="flex min-h-80 flex-col items-center justify-center gap-3 text-xs text-white/35">
            <span>{sourceSessionId ? "Bringing this AVA conversation into the room..." : "Create or open a room."}</span>
            {error && <div role="alert" className="rounded-lg border border-red-400/20 bg-red-400/8 px-3 py-2 text-xs text-red-200">{error}</div>}
          </div>
        ) : (
          <>
            {activeRoom?.sourceSessionId && (
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[rgba(92,242,255,.16)] bg-[rgba(92,242,255,.05)] px-3 py-2.5">
                <span className="flex items-center gap-2 text-[10px] leading-4 text-white/55">
                  <MessagesSquare size={13} className="text-[var(--ac)]" />
                  Linked to AVA chat through message {activeRoom.sourceThroughMessageId}
                  {activeRoom.returnedAt ? " - conclusion returned" : ""}
                </span>
                {onOpenChat && (
                  <button
                    type="button"
                    onClick={() => onOpenChat(activeRoom.sourceSessionId!)}
                    className="btn-deck btn-ghost flex items-center gap-2"
                  >
                    <ArrowLeft size={12} /> Back to chat
                  </button>
                )}
              </div>
            )}
            <div className="no-scrollbar max-h-[54vh] min-h-80 space-y-3 overflow-y-auto pr-1">
              {detail.messages.map((message) => <MessageCard key={message.id} message={message} />)}
              <div ref={bottomRef} />
            </div>
            {error && <div role="alert" className="mt-3 rounded-lg border border-red-400/20 bg-red-400/8 px-3 py-2 text-xs text-red-200">{error}</div>}
            <form onSubmit={send} className="mt-4 border-t border-white/[0.07] pt-4">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                aria-label="Message the strategy room"
                rows={3}
                placeholder={activeRoom?.status === "discussing" ? "Chime in — this interrupts the current round…" : "Add your thought or correction…"}
                className="w-full resize-none rounded-xl border border-white/10 bg-black/35 px-3 py-2.5 text-xs leading-5 outline-none placeholder:text-white/30 focus:border-[rgba(92,242,255,.4)]"
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] text-white/35">Your message becomes shared context for both agents.</span>
                <button disabled={busy || !draft.trim()} className="btn-deck btn-primary flex items-center gap-2 disabled:opacity-40">
                  <Send size={12} /> {activeRoom?.status === "discussing" ? "Interrupt & add" : "Add to room"}
                </button>
              </div>
            </form>
          </>
        )}
      </PanelSection>

      <div className="lg:col-span-3">
        <PanelSection title="Participants">
          <div className="space-y-2.5">
            {(["niko", "ava", "codex"] as const).map((actor) => {
              const look = ACTOR[actor];
              const Icon = look.icon;
              const status = participantStatus(actor, activeRoom, meta);
              return (
                <div key={actor} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
                  <span className="flex items-center gap-2 text-xs" style={{ color: look.color }}><Icon size={14} /> {look.label}</span>
                  <span className="hud text-[8px] text-white/40">{status}</span>
                </div>
              );
            })}
          </div>
          {codexSession && <p className="mt-3 break-all text-[9px] text-white/30">Codex room thread: {codexSession}…</p>}
          <p className="mt-3 text-[10px] leading-5 text-white/35">Codex is a dedicated read-only room thread, not a simulated AVA response.</p>
        </PanelSection>

        <PanelSection title="Living brief">
          <div className="no-scrollbar max-h-[36vh] overflow-y-auto pr-1"><Brief text={activeRoom?.livingBrief ?? null} /></div>
          {activeRoom?.status === "awaiting_niko" && (
            <div className="mt-4 border-t border-white/[0.07] pt-4">
              <button
                disabled={busy}
                onClick={() => void runAction(() => approveStrategyRoom(activeRoom.id, activeRoom.version))}
                className="btn-deck btn-primary flex w-full items-center justify-center gap-2 disabled:opacity-40"
              >
                <Check size={13} /> Approve conclusion
              </button>
              <p className="mt-2 text-[9px] leading-4 text-white/35">Records the decision only. It does not begin development.</p>
            </div>
          )}
          {activeRoom?.status === "approved" && activeRoom.sourceSessionId && (
            <div className="mt-4 border-t border-white/[0.07] pt-4">
              <button
                disabled={busy}
                onClick={() => void returnToChat()}
                className="btn-deck btn-primary flex w-full items-center justify-center gap-2 disabled:opacity-40"
              >
                <MessagesSquare size={13} />
                {activeRoom.returnedMessageId === null ? "Return conclusion to AVA chat" : "Open AVA chat"}
              </button>
              <p className="mt-2 text-[9px] leading-4 text-white/35">
                {activeRoom.returnedMessageId === null
                  ? "Adds the approved conclusion to the linked chat. It does not execute it."
                  : "The conclusion is in the linked chat, ready for your instruction."}
              </p>
            </div>
          )}
          {activeRoom?.status === "discussing" && (
            <button
              disabled={busy}
              onClick={() => void runAction(() => pauseStrategyRoom(activeRoom.id, activeRoom.version))}
              className="btn-deck btn-danger mt-4 flex w-full items-center justify-center gap-2 disabled:opacity-40"
            >
              <CirclePause size={13} /> Pause discussion
            </button>
          )}
          {activeRoom && ["paused", "failed", "approved"].includes(activeRoom.status) && (
            <button
              disabled={busy}
              onClick={() => void runAction(() => resumeStrategyRoom(activeRoom.id, activeRoom.version))}
              className="btn-deck btn-ghost mt-4 flex w-full items-center justify-center gap-2 disabled:opacity-40"
            >
              <CirclePlay size={13} /> Reopen discussion
            </button>
          )}
        </PanelSection>
      </div>
    </PanelShell>
  );
}
