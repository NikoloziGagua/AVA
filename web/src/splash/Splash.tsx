import { useEffect } from "react";
import { motion } from "motion/react";
import { Orb } from "../components/ava/Orb.js";
import { NebulaBackground } from "../components/ava/NebulaBackground.js";

/**
 * Cinematic intro: the mercury orb materializes (scale + blur in) and "AVA"
 * reveals letter-by-letter, then hands off to the home (the orb carries over via
 * GSAP Flip — same `flipId`).
 */
export function Splash({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const id = setTimeout(onDone, 1700);
    return () => clearTimeout(id);
  }, [onDone]);

  const letters = "AVA".split("");

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <NebulaBackground />
      <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
        <motion.div
          initial={{ scale: 0.4, opacity: 0, filter: "blur(22px)" }}
          animate={{ scale: 1, opacity: 1, filter: "blur(0px)" }}
          transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
        >
          <Orb size={140} state="idle" flipId="ava-orb" />
        </motion.div>
        <div className="mt-6 flex text-5xl font-semibold tracking-[0.34em] text-white/90">
          {letters.map((ch, i) => (
            <motion.span
              key={i}
              initial={{ y: 40, opacity: 0, filter: "blur(8px)" }}
              animate={{ y: 0, opacity: 1, filter: "blur(0px)" }}
              transition={{ delay: 0.5 + i * 0.1, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className="inline-block"
            >
              {ch}
            </motion.span>
          ))}
        </div>
      </div>
    </div>
  );
}
