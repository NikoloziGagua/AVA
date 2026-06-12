import { type CSSProperties, type PointerEvent, type ReactNode } from "react";

export interface BorderGlowProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Tag the card as a deck section so it joins the panel-enter stagger. */
  dataPanelSection?: boolean;
}

/**
 * Light a `.bg-card`'s cursor-following cyan/mercury border ring toward the pointer.
 * Operates on the event's `currentTarget`, so ANY `.bg-card` element can share it
 * (BorderGlow, the Important-chats pin cards, …) — wire it as `onPointerMove`.
 * Sets `--edge` (0 at centre → 1 at any edge, drives the ring/glow opacity) and
 * `--angle` (the gradient rotation toward the cursor).
 */
export function igniteBorder(e: PointerEvent<HTMLElement>): void {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const dx = e.clientX - r.left - r.width / 2;
  const dy = e.clientY - r.top - r.height / 2;
  const kx = dx !== 0 ? r.width / 2 / Math.abs(dx) : Infinity;
  const ky = dy !== 0 ? r.height / 2 / Math.abs(dy) : Infinity;
  const edge = Math.min(Math.max(1 / Math.min(kx, ky), 0), 1);
  const angle = (Math.atan2(dy, dx) * (180 / Math.PI) + 90 + 360) % 360;
  el.style.setProperty("--edge", edge.toFixed(3));
  el.style.setProperty("--angle", `${angle.toFixed(1)}deg`);
}

/** Douse the border ring (pointer left the card). Pair with `onPointerLeave`. */
export function douseBorder(e: PointerEvent<HTMLElement>): void {
  e.currentTarget.style.setProperty("--edge", "0");
}

/**
 * A glass card whose cyan/mercury border IGNITES near the pointer and a soft glow
 * follows the cursor's edge — the "glowing-ray box": dark glass + thin glowing
 * corner brackets + a diagonal light ray, all CALM at rest and lit by proximity.
 *
 * It's used on every deck section (5-8 per panel), so it deliberately drops the
 * heavy original (7 mesh gradients + mask-composite fill + a giant box-shadow
 * stack). Instead, everything is driven by a single CSS var `--edge` (0 at centre →
 * 1 at any edge), set on `onPointerMove` (a React-delegated handler, so one real
 * listener) and reset on leave:
 *   • `::before`  — a 1px conic gradient border ring that rotates to the cursor.
 *   • `::after`   — a soft outer edge glow.
 *   • 4 `.bg-card__bracket` corner L-brackets — faint at rest, brighten/extend with --edge.
 *   • 1 `.bg-card__ray`     — a diagonal specular sheen that intensifies with --edge.
 * Nothing animates at rest — the vars only change while a card is hovered — so it's
 * cheap with 8 cards on screen. The bracket/ray nodes are static, decorative, and
 * interaction-driven, so reduced-motion needs no special branch. Styles live in
 * theme.css (.bg-card and friends).
 */
export function BorderGlow({ children, className, style, dataPanelSection }: BorderGlowProps) {
  return (
    <div
      onPointerMove={igniteBorder}
      onPointerLeave={douseBorder}
      {...(dataPanelSection ? { "data-panel-section": "" } : {})}
      className={"bg-card " + (className ?? "")}
      style={style}
    >
      {/* Diagonal light ray + glowing corner brackets — calm at rest, lit by --edge. */}
      <span aria-hidden className="bg-card__ray" />
      <span aria-hidden className="bg-card__bracket bg-card__bracket--tl" />
      <span aria-hidden className="bg-card__bracket bg-card__bracket--tr" />
      <span aria-hidden className="bg-card__bracket bg-card__bracket--bl" />
      <span aria-hidden className="bg-card__bracket bg-card__bracket--br" />
      {children}
    </div>
  );
}
