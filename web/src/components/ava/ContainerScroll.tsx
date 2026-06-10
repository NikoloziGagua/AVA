import { type ReactNode } from "react";
import { motion } from "motion/react";
import { useReducedMotion } from "../../lib/useReducedMotion.js";

export interface ContainerScrollProps {
  children: ReactNode;
  className?: string;
}

/**
 * 3D perspective "settle" wrapper — a taste-driven adaptation of the Aceternity
 * ContainerScroll (which tilts `rotateX` 20deg→0 across a tall scroll hero). Here the
 * Important-chats strip sits at the TOP of the Chats panel, so a giant scroll-linked
 * hero (`h-[60rem]`) would not fit. Instead this plays the SAME "tilt and settle into
 * place" moment ONCE on mount: the outer wrapper holds the `perspective`, and the inner
 * `motion.div` animates from a forward-leaning `rotateX: 18deg` (+ a slight `scale 0.96`
 * and a small downward `y`) to flat/identity, on the deck's cinematic ease. The strip
 * reads as a panel of glass settling onto the deck.
 *
 * REDUCED MOTION: render the children flat with no perspective/transform.
 *
 * Light by design — one mount transition, no scroll listeners, no refs threaded.
 */
export function ContainerScroll({ children, className }: ContainerScrollProps) {
  const reduced = useReducedMotion();

  if (reduced) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div className={className} style={{ perspective: "1000px" }}>
      <motion.div
        style={{ transformStyle: "preserve-3d", transformOrigin: "center top" }}
        initial={{ rotateX: 18, scale: 0.96, y: 14, opacity: 0 }}
        animate={{ rotateX: 0, scale: 1, y: 0, opacity: 1 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      >
        {children}
      </motion.div>
    </div>
  );
}
