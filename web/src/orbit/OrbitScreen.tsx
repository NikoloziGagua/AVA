import { useEffect, useRef, useState, type ComponentType } from "react";
import { Plus, List, Brain, Settings2 } from "lucide-react";
import { Pulse } from "../components/ava/Pulse.js";
import { SpaceBackground } from "../components/ava/SpaceBackground.js";
import { CyclingText } from "../components/ava/CyclingText.js";
import { Alert, AlertDescription } from "../components/ui/alert.js";
import { computeNodePosition } from "../components/ava/OrbitRing.js";
import { OrbitNode } from "./OrbitNode.js";
import { useOrbitRotation } from "./useOrbitRotation.js";
import { api, fetchSessions, type SessionRow } from "../api.js";
import { useLongPress } from "./useLongPress.js";

type ToolNode = {
  angleDeg: number;
  label: string;
  Icon: ComponentType<{ size?: number | string; className?: string }>;
  action: () => void;
  /** CSS color used for the gradient ring + glow when hovered. */
  accent: string;
};

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

  const tools: ToolNode[] = [
    { angleDeg: 315, label: "new",    Icon: Plus,       accent: "168,85,247",  action: () => onOpenChat(null) },
    { angleDeg: 45,  label: "list",   Icon: List,       accent: "59,130,246",  action: onOpenList },
    { angleDeg: 135, label: "memory", Icon: Brain,      accent: "20,184,166",  action: onOpenMemory },
    { angleDeg: 225, label: "rules",  Icon: Settings2,  accent: "168,85,247",  action: onOpenRules },
  ];

  return (
    <div className="relative w-full h-full overflow-hidden bg-black">
      {/* Aurora layers — slowly rotating conic gradient + soft central glow + stars */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="ava-aurora" />
      </div>
      <div className="ava-aurora-glow" />
      <SpaceBackground particleCount={500} coreRadius={130} tintHue={270} />

      {/* HELLO / I AM / AVA — cycling cinematic wordmark */}
      <div className="absolute top-[12%] left-1/2 -translate-x-1/2 z-20 pointer-events-none w-full text-center">
        <CyclingText
          texts={["HELLO", "I AM", "AVA"]}
          intervalMs={2200}
          className="text-5xl sm:text-6xl font-bold tracking-[0.22em] bg-clip-text text-transparent bg-gradient-to-b from-white via-white/85 to-white/40"
        />
      </div>

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

      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-white/10"
        style={{ width: INNER_RADIUS * 2, height: INNER_RADIUS * 2 }}
      />
      {tools.map((t, i) => {
        const rad = (t.angleDeg * Math.PI) / 180;
        const x = INNER_RADIUS * Math.cos(rad);
        const y = INNER_RADIUS * Math.sin(rad);
        const Icon = t.Icon;
        return (
          <button
            key={i}
            type="button"
            className="group absolute left-1/2 top-1/2 z-10 flex flex-col items-center"
            style={{ transform: `translate(${x}px, ${y}px) translate(-50%, -50%)` }}
            onClick={t.action}
          >
            <span
              className="relative w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 cursor-pointer"
              style={{
                background: "radial-gradient(circle at 30% 25%, rgba(255,255,255,0.08), rgba(0,0,0,0.85) 70%)",
                border: "1px solid rgba(255,255,255,0.12)",
                boxShadow: `0 0 0 0 rgba(${t.accent},0)`,
              }}
            >
              {/* Hover ring — gradient stroke + glow */}
              <span
                aria-hidden="true"
                className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{
                  background: `conic-gradient(from 0deg, rgba(${t.accent},0.7), rgba(${t.accent},0.1), rgba(${t.accent},0.7))`,
                  padding: 1,
                  WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
                  WebkitMaskComposite: "xor",
                  maskComposite: "exclude",
                }}
              />
              <span
                aria-hidden="true"
                className="absolute inset-0 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{ boxShadow: `0 0 24px rgba(${t.accent},0.55)` }}
              />
              <Icon size={18} className="relative text-white/85 group-hover:text-white transition-colors" />
            </span>
            <span className="mt-2 text-[9px] text-white/50 group-hover:text-white/85 uppercase tracking-[0.18em] whitespace-nowrap transition-colors">
              {t.label}
            </span>
          </button>
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
