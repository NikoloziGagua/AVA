import { useEffect, useRef, useState } from "react";
import { Pulse } from "../components/ava/Pulse.js";
import { PathsBackground } from "../components/ava/PathsBackground.js";
import { Alert, AlertDescription } from "../components/ui/alert.js";
import { computeNodePosition } from "../components/ava/OrbitRing.js";
import { OrbitNode } from "./OrbitNode.js";
import { useOrbitRotation } from "./useOrbitRotation.js";
import { api, fetchSessions, type SessionRow } from "../api.js";
import { useLongPress } from "./useLongPress.js";

const INNER_RADIUS = 90;
const OUTER_RADIUS = 170;
const MAX_CHAT_NODES = 8;
const UNDO_WINDOW_MS = 5000;

export interface OrbitScreenProps {
  onOpenChat: (sessionId: string | null) => void;
  onOpenMemory: () => void;
  onOpenRules: () => void;
  onOpenList: () => void;
  onEnterVoice: () => void;
}

interface PendingDelete {
  session: SessionRow;
  timeoutId: ReturnType<typeof setTimeout>;
}

export function OrbitScreen({
  onOpenChat, onOpenMemory, onOpenRules, onOpenList, onEnterVoice,
}: OrbitScreenProps) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [paused, setPaused] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const pendingRef = useRef<PendingDelete | null>(null);
  const { angle } = useOrbitRotation({ paused });

  const { progress: centerProgress, handlers: centerHandlers } = useLongPress({
    thresholdMs: 300,
    onTrigger: onEnterVoice,
  });

  useEffect(() => {
    fetchSessions().then(setSessions).catch(() => {});
  }, []);

  useEffect(() => {
    pendingRef.current = pendingDelete;
  }, [pendingDelete]);

  function commitDelete(s: SessionRow) {
    api.deleteSession(s.id).catch(() => {
      setSessions((prev) => prev.some((x) => x.id === s.id) ? prev : [s, ...prev]);
    });
  }

  function handleDelete(s: SessionRow) {
    setSessions((prev) => prev.filter((x) => x.id !== s.id));
    const timeoutId = setTimeout(() => {
      commitDelete(s);
      setPendingDelete(null);
    }, UNDO_WINDOW_MS);
    setPendingDelete({ session: s, timeoutId });
  }

  function handleUndo() {
    const p = pendingRef.current;
    if (!p) return;
    clearTimeout(p.timeoutId);
    setSessions((prev) => [p.session, ...prev]);
    setPendingDelete(null);
  }

  const visibleSessions = sessions.slice(0, MAX_CHAT_NODES);

  const tools = [
    { angleDeg: 315, label: "new", emoji: "+", action: () => onOpenChat(null) },
    { angleDeg: 45,  label: "list", emoji: "≡", action: onOpenList },
    { angleDeg: 135, label: "memory", emoji: "⊕", action: onOpenMemory },
    { angleDeg: 225, label: "rules", emoji: "⚙", action: onOpenRules },
  ];

  return (
    <div className="relative w-full h-full overflow-hidden bg-black">
      <PathsBackground opacity={0.1} />

      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 cursor-pointer"
        onPointerDown={centerHandlers.onPointerDown}
        onPointerUp={centerHandlers.onPointerUp}
        onPointerLeave={centerHandlers.onPointerLeave}
        onPointerCancel={centerHandlers.onPointerCancel}
        style={{
          filter: centerProgress > 0 ? `brightness(${1 + centerProgress * 0.6})` : undefined,
        }}
      >
        <Pulse layoutId="ava-pulse" state="idle" size={64} />
      </div>
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 z-20 pointer-events-none text-[9px] tracking-[0.2em] uppercase text-white/55 whitespace-nowrap" style={{ marginTop: 44 }}>
        hold to speak
      </div>

      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-white/10"
        style={{ width: INNER_RADIUS * 2, height: INNER_RADIUS * 2 }}
      />
      {tools.map((t, i) => {
        const rad = (t.angleDeg * Math.PI) / 180;
        const x = INNER_RADIUS * Math.cos(rad);
        const y = INNER_RADIUS * Math.sin(rad);
        return (
          <div
            key={i}
            className="absolute left-1/2 top-1/2 z-10 flex flex-col items-center cursor-pointer"
            style={{ transform: `translate(${x}px, ${y}px) translate(-50%, -50%)` }}
            onClick={t.action}
          >
            <div className="w-10 h-10 rounded-full border border-white/15 bg-black/70 backdrop-blur-md text-white flex items-center justify-center text-base hover:border-white/35 hover:bg-black/85 transition-colors">
              {t.emoji}
            </div>
            <div className="mt-1.5 text-[9px] text-white/55 uppercase tracking-wider whitespace-nowrap">{t.label}</div>
          </div>
        );
      })}

      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/8"
        style={{ width: OUTER_RADIUS * 2, height: OUTER_RADIUS * 2 }}
      />
      {visibleSessions.map((s, i) => {
        const p = computeNodePosition({
          index: i,
          total: Math.max(visibleSessions.length, 1),
          radius: OUTER_RADIUS,
          rotationDeg: angle,
        });
        return (
          <OrbitNode
            key={s.id}
            x={p.x} y={p.y} zIndex={p.zIndex} opacity={p.opacity}
            label={s.title ?? "Untitled"}
            deletable
            onTap={() => onOpenChat(s.id)}
            onDelete={() => handleDelete(s)}
            onHoverChange={(hovered) => setPaused(hovered)}
          />
        );
      })}

      {pendingDelete && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-12 w-72 z-50">
          <Alert variant="info" close onClose={() => {
            const p = pendingRef.current;
            if (p) {
              clearTimeout(p.timeoutId);
              commitDelete(p.session);
            }
            setPendingDelete(null);
          }}>
            <AlertDescription>
              Deleted “{pendingDelete.session.title ?? "Untitled"}”.
              <button className="ml-2 underline" onClick={handleUndo}>undo</button>
            </AlertDescription>
          </Alert>
        </div>
      )}
    </div>
  );
}
