import { useCallback, useRef, type CSSProperties, type ReactNode } from "react";

export interface BorderGlowProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Tag the card as a deck section so it joins the panel-enter stagger. */
  dataPanelSection?: boolean;
}

/**
 * A glass card whose cyan/mercury border IGNITES near the pointer and a soft glow
 * follows the cursor's edge — adapted (perf-light) from the owner's BorderGlow.
 *
 * It's used on every deck section (5-8 per panel), so it deliberately drops the
 * heavy original (7 mesh gradients + mask-composite fill + a giant box-shadow
 * stack). Instead: ONE conic gradient masked into a 1px border that rotates to the
 * cursor angle, its opacity ramped by edge-proximity, plus a single edge glow.
 * Nothing animates at rest — the CSS vars only change while a card is hovered (a
 * React-delegated onPointerMove, so one real listener), so it's cheap at scale.
 * The styles live in theme.css (.bg-card). Interaction-driven, so reduced-motion
 * needs no special branch.
 */
export function BorderGlow({ children, className, style, dataPanelSection }: BorderGlowProps) {
  const ref = useRef<HTMLDivElement>(null);

  const onMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - r.left - r.width / 2;
    const dy = e.clientY - r.top - r.height / 2;
    // Edge proximity: 0 at the centre → 1 at any edge.
    const kx = dx !== 0 ? (r.width / 2) / Math.abs(dx) : Infinity;
    const ky = dy !== 0 ? (r.height / 2) / Math.abs(dy) : Infinity;
    const edge = Math.min(Math.max(1 / Math.min(kx, ky), 0), 1);
    const angle = (Math.atan2(dy, dx) * (180 / Math.PI) + 90 + 360) % 360;
    el.style.setProperty("--edge", edge.toFixed(3));
    el.style.setProperty("--angle", `${angle.toFixed(1)}deg`);
  }, []);

  const onLeave = useCallback(() => {
    ref.current?.style.setProperty("--edge", "0");
  }, []);

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      {...(dataPanelSection ? { "data-panel-section": "" } : {})}
      className={"bg-card " + (className ?? "")}
      style={style}
    >
      {children}
    </div>
  );
}
