import { useEffect } from "react";
import { motion } from "motion/react";
import { PathsBackground } from "../components/ava/PathsBackground.js";

export function Splash({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const id = setTimeout(onDone, 1500);
    return () => clearTimeout(id);
  }, [onDone]);

  const letters = "Ava".split("");

  return (
    <div className="relative w-full h-full overflow-hidden bg-black">
      <motion.div
        initial={{ opacity: 1 }}
        animate={{ opacity: 0.15 }}
        transition={{ delay: 1.2, duration: 0.4 }}
        className="absolute inset-0"
      >
        <PathsBackground opacity={1} />
      </motion.div>
      <motion.div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        initial={{ scale: 1 }}
        animate={{ scale: 0.4 }}
        transition={{ delay: 1.2, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      >
        <h1 className="text-7xl font-bold tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-white to-white/70">
          {letters.map((ch, i) => (
            <motion.span
              key={i}
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: i * 0.08, type: "spring", stiffness: 150, damping: 25 }}
              className="inline-block"
            >
              {ch}
            </motion.span>
          ))}
        </h1>
      </motion.div>
    </div>
  );
}
