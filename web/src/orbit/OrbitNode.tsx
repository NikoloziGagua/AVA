import { motion } from "motion/react";
import { useState } from "react";
import { X } from "lucide-react";
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

  const armedRed = armed || progress > 0.05;
  const rimAlpha = 0.18 + progress * 0.6;

  return (
    <motion.div
      className="orbit-node absolute left-1/2 top-1/2"
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
      <div
        className="relative flex cursor-pointer items-center justify-center rounded-full"
        style={{
          width: size,
          height: size,
          background: armedRed
            ? `rgba(239, 68, 68, ${rimAlpha})`
            : "linear-gradient(135deg, rgba(247,239,226,0.18), rgba(216,189,131,0.05))",
          border: armedRed
            ? `1px solid rgba(239,68,68,${0.3 + progress * 0.7})`
            : "1px solid rgba(216,189,131,0.24)",
          backdropFilter: "blur(12px) saturate(140%)",
          WebkitBackdropFilter: "blur(12px) saturate(140%)",
          boxShadow: armed
            ? "0 0 22px rgba(239,68,68,0.6)"
            : hovered
            ? "0 0 18px rgba(216,189,131,0.38), inset 0 1px 0 rgba(255,255,255,0.26)"
            : "inset 0 1px 0 rgba(255,255,255,0.15), 0 4px 14px -4px rgba(0,0,0,0.5)",
          transition: "box-shadow 200ms, background 120ms",
        }}
      >
        {!armedRed && <HoverHalo hovered={hovered} accent="216,189,131" idleDurationS={8} hoverDurationS={2} />}
        <span
          className="block h-1.5 w-1.5 rounded-full"
          style={{
            background: armedRed ? "#fff" : "linear-gradient(135deg, #fffaf0, #d8bd83)",
            boxShadow: armedRed ? undefined : "0 0 8px rgba(216,189,131,0.65)",
          }}
        />
      </div>

      <div
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] tracking-[0.05em] transition-opacity duration-200"
        style={{
          top: size + 6,
          color: "rgba(247,239,226,0.55)",
          textShadow: "0 1px 6px rgba(0,0,0,0.85)",
          maxWidth: 110,
          overflow: "hidden",
          textOverflow: "ellipsis",
          opacity: hovered || armed ? 0 : 1,
        }}
      >
        {label}
      </div>
      <motion.div
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded-[8px] px-2.5 py-1 text-[10px] tracking-wider text-[var(--ava-ink)]"
        style={{
          top: size + 6,
          background: "rgba(15, 14, 11, 0.72)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          border: "1px solid rgba(216,189,131,0.18)",
          maxWidth: 180,
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
        initial={{ opacity: 0, y: -2, scale: 0.95 }}
        animate={{ opacity: hovered || armed ? 1 : 0, y: hovered || armed ? 0 : -2, scale: hovered || armed ? 1 : 0.95 }}
        transition={{ duration: 0.18 }}
      >
        {label}
      </motion.div>

      {armed && (
        <button
          aria-label="confirm delete"
          onClick={(e) => { e.stopPropagation(); setArmed(false); onDelete?.(); }}
          className="absolute -right-3 -top-3 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white shadow-[0_0_14px_rgba(239,68,68,0.7)]"
        >
          <X size={12} />
        </button>
      )}
    </motion.div>
  );
}
