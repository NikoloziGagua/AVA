import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

export interface CyclingTextProps {
  texts: string[];
  /** ms between text swaps */
  intervalMs?: number;
  className?: string;
}

export function CyclingText({ texts, intervalMs = 2200, className }: CyclingTextProps) {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (texts.length <= 1) return;
    const id = setInterval(() => {
      setI((prev) => (prev + 1) % texts.length);
    }, intervalMs);
    return () => clearInterval(id);
  }, [texts.length, intervalMs]);

  return (
    <div className={className} style={{ position: "relative" }}>
      <AnimatePresence mode="wait">
        <motion.span
          key={i}
          initial={{ opacity: 0, filter: "blur(24px)", y: 8 }}
          animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
          exit={{ opacity: 0, filter: "blur(24px)", y: -8 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          style={{ display: "inline-block" }}
        >
          {texts[i]}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}
