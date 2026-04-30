import * as React from "react";
import { motion } from "motion/react";

export type PulseState = "idle" | "listening" | "thinking" | "responding";

export interface PulseProps {
  state: PulseState;
  size: number;
  amplitude?: number;
  layoutId?: string;
  className?: string;
}

const COLORS_IDLE = "linear-gradient(135deg, #a855f7, #3b82f6, #14b8a6)";
const COLORS_RESPONDING = "linear-gradient(135deg, #3b82f6, #14b8a6, #a855f7)";
const SHIMMER = "linear-gradient(110deg, #404040 35%, #fff 50%, #404040 65%)";

export function Pulse({ state, size, amplitude = 0, layoutId, className }: PulseProps) {
  const baseStyle: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: "50%",
    boxShadow: state === "listening"
      ? "0 0 80px rgba(168,85,247,0.6)"
      : state === "responding"
      ? "0 0 100px rgba(59,130,246,0.7)"
      : state === "thinking"
      ? "0 0 60px rgba(255,255,255,0.2)"
      : "0 0 40px rgba(168,85,247,0.45)",
  };

  if (state === "idle") {
    return (
      <motion.div
        layoutId={layoutId}
        className={className}
        style={{ ...baseStyle, backgroundImage: COLORS_IDLE }}
        animate={{ scale: [0.96, 1.04, 0.96] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      />
    );
  }

  if (state === "listening") {
    const scale = 0.85 + amplitude * 0.3;
    return (
      <motion.div
        layoutId={layoutId}
        className={className}
        style={{ ...baseStyle, backgroundImage: COLORS_IDLE, scale }}
      />
    );
  }

  if (state === "responding") {
    return (
      <motion.div
        layoutId={layoutId}
        className={className}
        style={{ ...baseStyle, backgroundImage: COLORS_RESPONDING }}
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
      layoutId={layoutId}
      className={className}
      style={{
        ...baseStyle,
        backgroundImage: SHIMMER,
        backgroundSize: "200% 100%",
      }}
      initial={{ backgroundPosition: "200% 0" }}
      animate={{ backgroundPosition: "-200% 0" }}
      transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
    />
  );
}
