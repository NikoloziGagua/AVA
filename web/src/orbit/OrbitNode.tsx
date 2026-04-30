import { motion } from "motion/react";
import { useState } from "react";
import { useLongPress } from "./useLongPress.js";

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
  x, y, zIndex, opacity, label, size = 24,
  deletable = false, onTap, onDelete, onHoverChange,
}: OrbitNodeProps) {
  const [armed, setArmed] = useState(false);
  const { progress, handlers } = useLongPress({
    thresholdMs: 500,
    onTrigger: () => { if (deletable) setArmed(true); },
  });

  const ringR = 255;
  const ringG = Math.round(255 * (1 - progress));
  const ringB = Math.round(255 * (1 - progress));
  const ringColor = armed
    ? "rgb(239,68,68)"
    : `rgb(${ringR},${ringG},${ringB})`;

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
      onPointerEnter={() => onHoverChange?.(true)}
      onPointerLeave={() => { onHoverChange?.(false); handlers.onPointerLeave(); }}
      onPointerDown={handlers.onPointerDown}
      onPointerUp={handlers.onPointerUp}
      onPointerCancel={handlers.onPointerCancel}
    >
      <div
        className="rounded-full flex items-center justify-center"
        style={{
          width: size, height: size,
          background: "rgba(0,0,0,0.6)",
          border: `1.5px solid ${ringColor}`,
          boxShadow: armed ? "0 0 18px rgba(239,68,68,0.6)" : undefined,
          transition: "box-shadow 200ms",
        }}
      />
      <div
        className="absolute left-1/2 -translate-x-1/2 mt-2 text-[10px] tracking-wider whitespace-nowrap text-white/70"
        style={{ top: size + 4, maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis" }}
      >
        {label}
      </div>
      {armed && (
        <button
          aria-label="confirm delete"
          onClick={(e) => { e.stopPropagation(); setArmed(false); onDelete?.(); }}
          className="absolute -right-3 -top-3 w-6 h-6 rounded-full bg-red-500 text-white text-xs flex items-center justify-center"
        >
          ✕
        </button>
      )}
    </motion.div>
  );
}
