import { motion, type Variants } from "motion/react";

export type TextEffectPreset = "blur" | "scale" | "fade" | "slide";

export interface TextEffectProps {
  text: string;
  preset?: TextEffectPreset;
  per?: "char" | "word";
  delay?: number;
  staggerChildren?: number;
  className?: string;
}

const containerVariants: Variants = {
  hidden: { opacity: 1 },
  visible: { opacity: 1 },
};

const presets: Record<TextEffectPreset, Variants> = {
  blur: {
    hidden: { opacity: 0, filter: "blur(12px)", y: 6 },
    visible: { opacity: 1, filter: "blur(0px)", y: 0 },
  },
  scale: {
    hidden: { opacity: 0, scale: 0.6 },
    visible: { opacity: 1, scale: 1 },
  },
  fade: {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
  },
  slide: {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0 },
  },
};

export function TextEffect({
  text,
  preset = "blur",
  per = "char",
  delay = 0,
  staggerChildren,
  className,
}: TextEffectProps) {
  const itemVariants = presets[preset];
  const stagger = staggerChildren ?? (per === "char" ? 0.04 : 0.08);
  const segments = per === "word" ? text.split(/(\s+)/) : text.split("");

  return (
    <motion.span
      className={className}
      initial="hidden"
      animate="visible"
      variants={containerVariants}
      transition={{
        staggerChildren: stagger,
        delayChildren: delay,
      }}
      aria-label={text}
    >
      {segments.map((seg, i) => (
        <motion.span
          key={i}
          aria-hidden="true"
          variants={itemVariants}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="inline-block whitespace-pre"
        >
          {seg}
        </motion.span>
      ))}
    </motion.span>
  );
}
