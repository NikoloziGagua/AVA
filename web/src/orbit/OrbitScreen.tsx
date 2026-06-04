import { useEffect, useRef, useState, type ComponentType } from "react";
import { Plus, List, Brain, Settings2, Sparkles, Mic, ShieldCheck, Clock } from "lucide-react";
import { Pulse } from "../components/ava/Pulse.js";
import { DottedSurface } from "../components/ava/DottedSurface.js";
import { HoverHalo } from "../components/ava/HoverHalo.js";
import { Alert, AlertDescription } from "../components/ui/alert.js";
import { computeNodePosition } from "../components/ava/OrbitRing.js";
import { OrbitNode } from "./OrbitNode.js";
import { useOrbitRotation } from "./useOrbitRotation.js";
import { api, fetchSessions, type SessionRow } from "../api.js";
import { useLongPress } from "./useLongPress.js";
import { gsap, shouldReduceMotion, useGSAP } from "../lib/gsap.js";

type ToolNode = {
  angleDeg: number;
  label: string;
  Icon: ComponentType<{ size?: number | string; className?: string }>;
  action: () => void;
  accent: string;
};

const INNER_RADIUS = 96;
const OUTER_RADIUS = 182;
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
  const scope = useRef<HTMLDivElement>(null);
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
    { angleDeg: 270, label: "new", Icon: Plus, accent: "216,189,131", action: () => onOpenChat(null) },
    { angleDeg: 342, label: "list", Icon: List, accent: "93,124,255", action: onOpenList },
    { angleDeg: 54, label: "memory", Icon: Brain, accent: "71,214,167", action: onOpenMemory },
    { angleDeg: 126, label: "rules", Icon: Settings2, accent: "156,163,175", action: onOpenRules },
    { angleDeg: 198, label: "self", Icon: Sparkles, accent: "168,67,95", action: onOpenSelf },
  ];

  const [hoveredTool, setHoveredTool] = useState<number | null>(null);

  useGSAP(() => {
    if (!scope.current || shouldReduceMotion()) return;
    gsap.fromTo(
      ".orbit-reveal",
      { autoAlpha: 0, filter: "blur(12px)" },
      { autoAlpha: 1, filter: "blur(0px)", duration: 0.78, stagger: 0.06, ease: "power3.out" },
    );
    gsap.fromTo(
      ".orbit-tool",
      { autoAlpha: 0, filter: "blur(10px)" },
      { autoAlpha: 1, filter: "blur(0px)", duration: 0.62, stagger: 0.045, delay: 0.18, ease: "power3.out" },
    );
    gsap.fromTo(
      ".orbit-node",
      { autoAlpha: 0, filter: "blur(10px)" },
      { autoAlpha: 1, filter: "blur(0px)", duration: 0.4, stagger: 0.035, delay: 0.25, ease: "power2.out" },
    );
  }, { scope, dependencies: [visibleSessions.length] });

  return (
    <div ref={scope} className="ava-luxe-screen">
      <DottedSurface className="opacity-35" />
      <div className="absolute inset-0 z-[1] pointer-events-none bg-[linear-gradient(180deg,rgba(0,0,0,0.08),rgba(0,0,0,0.66))]" />

      <header className="orbit-reveal absolute inset-x-0 top-0 z-30 flex items-center justify-between px-5 py-5 sm:px-8">
        <div className="min-w-0">
          <div className="ava-kicker">private command</div>
          <div className="ava-metal-wordmark mt-2 text-3xl font-semibold tracking-[0.18em] sm:text-4xl">AVA</div>
        </div>
        <div className="hidden items-center gap-2 sm:flex">
          <div className="ava-chip flex items-center gap-2 px-3 text-[11px] uppercase tracking-[0.16em]">
            <ShieldCheck size={14} />
            paired
          </div>
          <div className="ava-chip flex items-center gap-2 px-3 text-[11px] uppercase tracking-[0.16em]">
            <Clock size={14} />
            live
          </div>
        </div>
      </header>

      <aside className="orbit-reveal absolute left-5 top-[42%] z-20 hidden w-56 -translate-y-1/2 md:block">
        <div className="ava-glass-panel p-4">
          <div className="ava-section-label">console</div>
          <div className="space-y-3 text-xs">
            <Metric label="sessions" value={String(sessions.length)} tone="champagne" />
            <Metric label="voice" value="armed" tone="jade" />
            <Metric label="memory" value="indexed" tone="cobalt" />
          </div>
        </div>
      </aside>

      <div className="orbit-reveal pointer-events-none absolute inset-x-5 top-[17%] z-20 text-center sm:top-[15%]">
        <div className="ava-kicker mb-3">intelligence atelier</div>
        <div className="ava-metal-wordmark text-[64px] font-semibold leading-none tracking-[0.22em] sm:text-[88px]">
          AVA
        </div>
      </div>

      <div
        className="orbit-reveal absolute left-1/2 top-1/2 z-10 h-[380px] w-[380px] -translate-x-1/2 -translate-y-1/2 sm:h-[470px] sm:w-[470px]"
        aria-hidden="true"
      >
        <div className="absolute inset-0 rounded-full ava-orbit-ring" />
        <div className="absolute inset-[13%] rounded-full border border-dashed border-[rgba(216,189,131,0.18)]" />
        <div className="absolute inset-[28%] rounded-full border border-[rgba(247,239,226,0.08)]" />
      </div>

      <button
        type="button"
        aria-label="enter voice"
        className="orbit-reveal absolute left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2 cursor-pointer"
        onPointerDown={centerHandlers.onPointerDown}
        onPointerUp={centerHandlers.onPointerUp}
        onPointerLeave={centerHandlers.onPointerLeave}
        onPointerCancel={centerHandlers.onPointerCancel}
        style={{
          filter: centerProgress > 0 ? `brightness(${1 + centerProgress * 0.6})` : undefined,
        }}
      >
        <span className="absolute -inset-9 rounded-full border border-[rgba(216,189,131,0.18)]" />
        <Pulse layoutId="ava-pulse" state="idle" size={72} />
        <span className="absolute left-1/2 top-[92px] -translate-x-1/2 whitespace-nowrap text-[10px] uppercase tracking-[0.24em] text-[var(--ava-fg-faint)]">
          voice gate
        </span>
      </button>

      {tools.map((t, i) => {
        const rad = (t.angleDeg * Math.PI) / 180;
        const x = INNER_RADIUS * Math.cos(rad);
        const y = INNER_RADIUS * Math.sin(rad);
        const Icon = t.Icon;
        const hovered = hoveredTool === i;
        return (
          <button
            key={t.label}
            type="button"
            className="orbit-tool group absolute left-1/2 top-1/2 z-20 flex flex-col items-center"
            style={{ transform: `translate(${x}px, ${y}px) translate(-50%, -50%)` }}
            onClick={t.action}
            onPointerEnter={() => setHoveredTool(i)}
            onPointerLeave={() => setHoveredTool((cur) => (cur === i ? null : cur))}
          >
            <span
              className="relative flex h-12 w-12 items-center justify-center rounded-full transition-all duration-300"
              style={{
                background: "linear-gradient(135deg, rgba(247,239,226,0.13), rgba(247,239,226,0.025))",
                border: "1px solid rgba(217,191,140,0.22)",
                backdropFilter: "blur(18px) saturate(160%)",
                WebkitBackdropFilter: "blur(18px) saturate(160%)",
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.16), inset 0 -1px 0 rgba(0,0,0,0.25), 0 14px 38px -18px rgba(0,0,0,0.85)",
              }}
            >
              <HoverHalo hovered={hovered} accent={t.accent} />
              <span
                aria-hidden="true"
                className="absolute inset-0 rounded-full transition-opacity duration-300 pointer-events-none"
                style={{
                  opacity: hovered ? 1 : 0,
                  boxShadow: `0 0 32px rgba(${t.accent},0.5)`,
                }}
              />
              <Icon size={18} className="relative text-[var(--ava-ink)] opacity-85 transition-opacity group-hover:opacity-100" />
            </span>
            <span className="mt-2 whitespace-nowrap text-[9px] uppercase tracking-[0.22em] text-[var(--ava-fg-faint)] transition-colors group-hover:text-[var(--ava-ink)]">
              {t.label}
            </span>
          </button>
        );
      })}

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

      <div className="orbit-reveal absolute bottom-6 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-[var(--ava-fg-faint)]">
        <Mic size={13} />
        <span>realtime voice</span>
      </div>

      {pendingDelete && (
        <div className="absolute left-1/2 z-50 w-72 -translate-x-1/2 bottom-12">
          <Alert variant="info" close onClose={() => {
            const p = pendingRef.current;
            if (p) {
              clearTimeout(p.timeoutId);
              commitDelete(p.session);
            }
            setPendingDelete(null);
          }}>
            <AlertDescription>
              Deleted "{pendingDelete.session.title ?? "Untitled"}".
              <button className="ml-2 underline" onClick={handleUndo}>undo</button>
            </AlertDescription>
          </Alert>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone: "champagne" | "jade" | "cobalt" }) {
  const color =
    tone === "jade" ? "var(--ava-jade)" :
    tone === "cobalt" ? "var(--ava-cobalt)" :
                         "var(--ava-champagne)";

  return (
    <div className="flex items-center justify-between gap-4">
      <span className="uppercase tracking-[0.18em] text-[var(--ava-fg-faint)]">{label}</span>
      <span className="font-medium" style={{ color }}>{value}</span>
    </div>
  );
}
