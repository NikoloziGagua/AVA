import * as React from "react";
import { motion } from "motion/react";
import { useReducedMotion } from "../../lib/useReducedMotion.js";

export type PulseState = "idle" | "listening" | "thinking" | "responding";

export interface PulseProps {
  state: PulseState;
  size: number;
  amplitude?: number;
  layoutId?: string;
  className?: string;
}

const COLORS_IDLE =
  "linear-gradient(135deg, #f8fafc 0%, #cbd5e1 25%, #64748b 50%, #cbd5e1 75%, #f8fafc 100%)";
const COLORS_RESPONDING =
  "linear-gradient(135deg, #e5e7eb 0%, #ffffff 30%, #94a3b8 50%, #ffffff 70%, #e5e7eb 100%)";
const SHIMMER = "linear-gradient(110deg, #475569 35%, #f8fafc 50%, #475569 65%)";

function shadowFor(state: PulseState): string {
  switch (state) {
    case "listening": return "0 0 80px rgba(241,245,249,0.55), 0 0 30px rgba(255,255,255,0.4)";
    case "responding": return "0 0 100px rgba(248,250,252,0.65), 0 0 35px rgba(255,255,255,0.5)";
    case "thinking": return "0 0 60px rgba(255,255,255,0.25)";
    default: return "0 0 40px rgba(226,232,240,0.45), 0 0 14px rgba(255,255,255,0.3)";
  }
}

export function Pulse({ state, size, amplitude = 0, layoutId, className }: PulseProps) {
  const reduced = useReducedMotion();
  const wrapperStyle: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: "50%",
    boxShadow: shadowFor(state),
    transition: "box-shadow 400ms ease",
    position: "relative",
  };

  if (reduced) {
    const bg =
      state === "responding" ? COLORS_RESPONDING :
      state === "thinking"   ? "linear-gradient(135deg, rgba(255,255,255,0.2), rgba(255,255,255,0.05))" :
                                COLORS_IDLE;
    return (
      <div
        className={className}
        style={{ ...wrapperStyle, backgroundImage: bg }}
      />
    );
  }

  return (
    <motion.div
      layoutId={layoutId}
      className={className}
      style={wrapperStyle}
    >
      <PulseInner state={state} amplitude={amplitude} />
    </motion.div>
  );
}

function PulseInner({ state, amplitude }: { state: PulseState; amplitude: number }) {
  const fillBase: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    borderRadius: "50%",
  };

  if (state === "idle") {
    return (
      <motion.div
        key="idle"
        style={{ ...fillBase, backgroundImage: COLORS_IDLE }}
        animate={{ scale: [0.96, 1.04, 0.96] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      />
    );
  }

  if (state === "listening") {
    const scale = 0.85 + amplitude * 0.3;
    return (
      <motion.div
        key="listening"
        style={{ ...fillBase, backgroundImage: COLORS_IDLE, scale }}
      />
    );
  }

  if (state === "responding") {
    return (
      <motion.div
        key="responding"
        style={{ ...fillBase, backgroundImage: COLORS_RESPONDING }}
        animate={{
          borderRadius: ["46% 54% 54% 46% / 52% 48% 52% 48%",
                          "54% 46% 46% 54% / 48% 52% 48% 52%",
                          "46% 54% 54% 46% / 52% 48% 52% 48%"],
        }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
      />
    );
  }

  return (
    <motion.div
      key="thinking"
      style={{
        ...fillBase,
        backgroundImage: SHIMMER,
        backgroundSize: "200% 100%",
      }}
      initial={{ backgroundPosition: "200% 0" }}
      animate={{ backgroundPosition: "-200% 0" }}
      transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
    />
  );
}
