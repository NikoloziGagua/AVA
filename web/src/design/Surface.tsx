import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn.js";

type Tone = "surface" | "raised" | "glass" | "sunken";
type Elevation = 0 | 1 | 2 | 3;

const TONE: Record<Tone, string> = {
  surface: "bg-surface",
  raised: "bg-raised",
  glass: "ds-glass",
  sunken: "bg-glass",
};
const ELEVATION: Record<Elevation, string> = { 0: "", 1: "shadow-e1", 2: "shadow-e2", 3: "shadow-e3" };
const RADIUS = { control: "rounded-control", button: "rounded-button", card: "rounded-card", sheet: "rounded-sheet" } as const;

export type SurfaceProps = HTMLAttributes<HTMLDivElement> & {
  tone?: Tone;
  elevation?: Elevation;
  /** Rounded corners: card (22) by default, sheet (30) for large panels. */
  radius?: keyof typeof RADIUS;
};

/** A floating surface. Separation comes from elevation and space, never a border. */
export const Surface = forwardRef<HTMLDivElement, SurfaceProps>(function Surface(
  { tone = "surface", elevation = 2, radius = "card", className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      data-ds-surface=""
      className={cn(TONE[tone], ELEVATION[elevation], RADIUS[radius], className)}
      {...props}
    />
  );
});

/** A padded surface for one piece of content. */
export const Card = forwardRef<HTMLDivElement, SurfaceProps>(function Card({ className, ...props }, ref) {
  return <Surface ref={ref} className={cn("grid content-start gap-3 p-4", className)} {...props} />;
});

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("text-body-lg text-ink", className)}>{children}</div>;
}

export function CardMeta({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("text-meta text-ink-2", className)}>{children}</div>;
}
