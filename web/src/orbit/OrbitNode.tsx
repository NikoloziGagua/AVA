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
}

export function OrbitNode({
  x, y, zIndex, opacity, label, size = 24,
  deletable = false, onTap, onDelete,
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
      className="absolute"
      style={{
        left: "50%",
        top: "50%",
        transform: `translate(${x}px, ${y}px)`,
        zIndex,
        opacity,
        touchAction: "manipulation",
        userSelect: "none",
      }}
      onClick={(e) => { e.stopPropagation(); if (!armed) onTap(); }}
      {...handlers}
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
        className="absolute left-1/2 -translate-x-1/2 mt-2 text-[8px] tracking-wider whitespace-nowrap text-white"
        style={{ opacity: 0.55, top: size }}
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
