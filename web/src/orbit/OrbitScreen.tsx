import { useEffect, useRef, useState, type ComponentType } from "react";
import { motion } from "motion/react";
import { Plus, List, Brain, Settings2, Sparkles } from "lucide-react";
import { Pulse } from "../components/ava/Pulse.js";
import { DottedSurface } from "../components/ava/DottedSurface.js";
import { HoverHalo } from "../components/ava/HoverHalo.js";
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
  onOpenSelf: () => void;
  onEnterVoice: () => void;
}

interface PendingDelete {
  session: SessionRow;
  timeoutId: ReturnType<typeof setTimeout>;
}

export function OrbitScreen({
  onOpenChat, onOpenMemory, onOpenRules, onOpenList, onOpenSelf, onEnterVoice,
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
    { angleDeg: 270, label: "new",    Icon: Plus,       accent: "248,250,252",  action: () => onOpenChat(null) },
    { angleDeg: 342, label: "list",   Icon: List,       accent: "248,250,252",  action: onOpenList },
    { angleDeg: 54,  label: "memory", Icon: Brain,      accent: "248,250,252",  action: onOpenMemory },
    { angleDeg: 126, label: "rules",  Icon: Settings2,  accent: "248,250,252",  action: onOpenRules },
    { angleDeg: 198, label: "self",   Icon: Sparkles,   accent: "248,250,252",  action: onOpenSelf },
  ];

  const [hoveredTool, setHoveredTool] = useState<number | null>(null);

  return (
    <div className="relative w-full h-full overflow-hidden bg-black">
      {/* Dotted surface — three.js wave grid */}
      <DottedSurface />
      {/* Soft vignette darkens edges + lifts the orb */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 48%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 70%, rgba(0,0,0,0.85) 100%)",
        }}
      />

      {/* I AM AVA — static cinematic wordmark with blur reveal */}
      <motion.div
        initial={{ opacity: 0, filter: "blur(20px)", y: 8 }}
        animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
        transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
        className="absolute top-[10%] left-1/2 -translate-x-1/2 z-20 pointer-events-none w-full text-center"
      >
        <div className="text-[10px] tracking-[0.45em] uppercase text-white/45 mb-2">I AM</div>
        <div className="text-6xl sm:text-7xl font-bold tracking-[0.22em] bg-clip-text text-transparent bg-gradient-to-b from-white via-white/90 to-white/50">
          AVA
        </div>
      </motion.div>

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
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-white/15"
        style={{
          width: INNER_RADIUS * 2,
          height: INNER_RADIUS * 2,
          backdropFilter: "blur(2px)",
        }}
      />
      {tools.map((t, i) => {
        const rad = (t.angleDeg * Math.PI) / 180;
        const x = INNER_RADIUS * Math.cos(rad);
        const y = INNER_RADIUS * Math.sin(rad);
        const Icon = t.Icon;
        const hovered = hoveredTool === i;
        return (
          <button
            key={i}
            type="button"
            className="group absolute left-1/2 top-1/2 z-10 flex flex-col items-center"
            style={{ transform: `translate(${x}px, ${y}px) translate(-50%, -50%)` }}
            onClick={t.action}
            onPointerEnter={() => setHoveredTool(i)}
            onPointerLeave={() => setHoveredTool((cur) => (cur === i ? null : cur))}
          >
            {/* Glass pill */}
            <span
              className="relative w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 cursor-pointer"
              style={{
                background: "linear-gradient(135deg, rgba(255,255,255,0.14), rgba(255,255,255,0.03))",
                border: "1px solid rgba(255,255,255,0.10)",
                backdropFilter: "blur(18px) saturate(160%)",
                WebkitBackdropFilter: "blur(18px) saturate(160%)",
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.18), inset 0 -1px 0 rgba(0,0,0,0.25), 0 8px 28px -10px rgba(0,0,0,0.7)",
              }}
            >
              {/* Always-rotating halo (subtle), brightens + speeds up on hover */}
              <HoverHalo hovered={hovered} accent={t.accent} />
              {/* Hover ambient glow */}
              <span
                aria-hidden="true"
                className="absolute inset-0 rounded-full transition-opacity duration-300 pointer-events-none"
                style={{
                  opacity: hovered ? 1 : 0,
                  boxShadow: `0 0 32px rgba(${t.accent},0.55)`,
                }}
              />
              <Icon size={18} className="relative text-white/90 group-hover:text-white transition-colors" />
            </span>
            <span className="mt-2 text-[9px] text-white/55 group-hover:text-white/95 uppercase tracking-[0.22em] whitespace-nowrap transition-colors">
              {t.label}
            </span>
          </button>
        );
      })}

      {/* Outer ring removed — chat nodes still orbit at OUTER_RADIUS but no visible track. */}
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
