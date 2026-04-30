import { motion } from "motion/react";

function FloatingPaths({ position }: { position: number }) {
  const paths = Array.from({ length: 36 }, (_, i) => ({
    id: i,
    d: `M-${380 - i * 5 * position} -${189 + i * 6}C-${380 - i * 5 * position} -${189 + i * 6} -${312 - i * 5 * position} ${216 - i * 6} ${152 - i * 5 * position} ${343 - i * 6}C${616 - i * 5 * position} ${470 - i * 6} ${684 - i * 5 * position} ${875 - i * 6} ${684 - i * 5 * position} ${875 - i * 6}`,
    width: 0.5 + i * 0.03,
  }));

  return (
    <svg className="absolute inset-0 w-full h-full text-white pointer-events-none" viewBox="0 0 696 316" fill="none" aria-hidden="true">
      {paths.map((p) => (
        <motion.path
          key={p.id}
          d={p.d}
          stroke="currentColor"
          strokeWidth={p.width}
          strokeOpacity={0.1 + p.id * 0.03}
          initial={{ pathLength: 0.3, opacity: 0.6 }}
          animate={{ pathLength: 1, opacity: [0.3, 0.6, 0.3], pathOffset: [0, 1, 0] }}
          transition={{ duration: 20 + Math.random() * 10, repeat: Infinity, ease: "linear" }}
        />
      ))}
    </svg>
  );
}

export function PathsBackground({ opacity = 1 }: { opacity?: number }) {
  return (
    <div className="absolute inset-0 pointer-events-none" style={{ opacity }} aria-hidden="true">
      <FloatingPaths position={1} />
      <FloatingPaths position={-1} />
    </div>
  );
}
