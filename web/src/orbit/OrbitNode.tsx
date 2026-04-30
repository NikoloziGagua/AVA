import { motion } from "motion/react";
import { useState } from "react";
import { useLongPress } from "./useLongPress.js";
import { HoverHalo } from "../components/ava/HoverHalo.js";

export interface OrbitNodeProps {
  x: number;
  y: number;
  zIndex: number;
  opacity: number;
  label: string;
  size?: number;
  deletable?: boolean;
  onTap: () => void;
  onDelete?: () => void;
  onHoverChange?: (hovered: boolean) => void;
}

export function OrbitNode({
  x, y, zIndex, opacity, label, size = 28,
  deletable = false, onTap, onDelete, onHoverChange,
}: OrbitNodeProps) {
  const [armed, setArmed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const { progress, handlers } = useLongPress({
    thresholdMs: 500,
    onTrigger: () => { if (deletable) setArmed(true); },
  });

  // Long-press fills the rim red over 500ms
  const armedRed = armed || progress > 0.05;
  const rimAlpha = 0.18 + progress * 0.6;

  return (
    <motion.div
      className="absolute left-1/2 top-1/2"
      style={{
        transform: `translate(${x}px, ${y}px) translate(-50%, -50%)`,
        zIndex,
        opacity,
        touchAction: "manipulation",
        userSelect: "none",
      }}
      onClick={(e) => { e.stopPropagation(); if (!armed) onTap(); }}
      onPointerEnter={() => { setHovered(true); onHoverChange?.(true); }}
      onPointerLeave={() => { setHovered(false); onHoverChange?.(false); handlers.onPointerLeave(); }}
      onPointerDown={handlers.onPointerDown}
      onPointerUp={handlers.onPointerUp}
      onPointerCancel={handlers.onPointerCancel}
    >
      {/* Glass dot */}
      <div
        className="relative rounded-full flex items-center justify-center cursor-pointer"
        style={{
          width: size,
          height: size,
          background: armedRed
            ? `rgba(239, 68, 68, ${rimAlpha})`
            : "linear-gradient(135deg, rgba(255,255,255,0.18), rgba(255,255,255,0.04))",
          border: armedRed
            ? `1px solid rgba(239,68,68,${0.3 + progress * 0.7})`
            : "1px solid rgba(255,255,255,0.18)",
          backdropFilter: "blur(12px) saturate(140%)",
          WebkitBackdropFilter: "blur(12px) saturate(140%)",
          boxShadow: armed
            ? "0 0 22px rgba(239,68,68,0.6)"
            : hovered
            ? "0 0 18px rgba(255,255,255,0.35), inset 0 1px 0 rgba(255,255,255,0.3)"
            : "inset 0 1px 0 rgba(255,255,255,0.15), 0 4px 14px -4px rgba(0,0,0,0.5)",
          transition: "box-shadow 200ms, background 120ms",
        }}
      >
        {!armedRed && <HoverHalo hovered={hovered} accent="248,250,252" idleDurationS={8} hoverDurationS={2} />}
        <span
          className="block w-1.5 h-1.5 rounded-full"
          style={{
            background: armedRed ? "#fff" : "linear-gradient(135deg, #f8fafc, #cbd5e1)",
            boxShadow: armedRed ? undefined : "0 0 8px rgba(255,255,255,0.6)",
          }}
        />
      </div>

      {/* Label — visible on hover with a glass plate so it's readable on any bg */}
      <motion.div
        className="absolute left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-md whitespace-nowrap pointer-events-none text-[10px] text-white/90 tracking-wider"
        style={{
          top: size + 8,
          background: "rgba(15, 15, 20, 0.6)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          border: "1px solid rgba(255,255,255,0.08)",
          maxWidth: 140,
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
        initial={{ opacity: 0, y: -2 }}
        animate={{ opacity: hovered || armed ? 1 : 0, y: hovered || armed ? 0 : -2 }}
        transition={{ duration: 0.18 }}
      >
        {label}
      </motion.div>

      {armed && (
        <button
          aria-label="confirm delete"
          onClick={(e) => { e.stopPropagation(); setArmed(false); onDelete?.(); }}
          className="absolute -right-3 -top-3 w-6 h-6 rounded-full bg-red-500 text-white text-xs flex items-center justify-center shadow-[0_0_14px_rgba(239,68,68,0.7)]"
        >
          ✕
        </button>
      )}
    </motion.div>
  );
}
