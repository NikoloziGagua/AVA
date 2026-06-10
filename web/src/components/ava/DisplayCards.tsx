import { type CSSProperties } from "react";
import { Star } from "lucide-react";
import { useReducedMotion } from "../../lib/useReducedMotion.js";
import { igniteBorder, douseBorder } from "./BorderGlow.js";

export interface DisplayCard {
  id: string;
  title: string;
  subtitle: string;
  onOpen: () => void;
  onUnpin: () => void;
}

export interface DisplayCardsProps {
  cards: DisplayCard[];
}

/**
 * How many cards we lay out in the physical skew-stack. Exported so the Chats
 * screen caps its strip at the same number and overflows any further pinned chats
 * into the table (a 5th+ pin must never become invisible).
 */
export const MAX_FANNED = 4;

/**
 * "Important chats" cluster — a taste-driven adaptation of the owner's DisplayCards,
 * recolored into the cyan/mercury deck.
 *
 * RESTING STATE: up to four `.bg-card` glass slabs share ONE grid cell
 * (`grid-template-areas:'stack'`) so they OVERLAP in a pile. The whole pile is skewed
 * (`skewY(-8deg)`, in theme.css). The front card (index 0, highest z-index) is full
 * cyan; each card BEHIND it is nudged right+down (`data-depth` → `translate(...)`) and
 * DESATURATED + dimmed, so the pile reads as a stack receding off-frame (helped by a
 * right-edge gradient fade on `.dc-stack::after`). This is the deck's reading of the
 * reference's "grayscale-at-rest" depth cue.
 *
 * HOVER: each card lifts on its OWN hover — a back card slides UP out of the pile to
 * flat and goes full-colour (`saturate(1) brightness(1)`), the front card lifts a hair.
 * All pure CSS transitions (`700ms` cinematic), so nothing animates at rest and it's
 * cheap with four cards. The cursor-following cyan border (igniteBorder/douseBorder)
 * still lights per card.
 *
 * REDUCED MOTION: no skew, no stack, no desaturation, no transforms. The cards park as
 * a neat, flat, evenly-spaced grid (`.dc-flat`), every card fully readable.
 *
 * Each card shows the chat title, a `.hud` last-active subtitle, and a LIT cyan star
 * that unpins (stopPropagation). Clicking the card body opens the chat.
 */
export function DisplayCards({ cards }: DisplayCardsProps) {
  const reduced = useReducedMotion();
  const shown = cards.slice(0, MAX_FANNED);
  const n = shown.length;

  if (n === 0) return null;

  // Reduced motion: a neat, flat, evenly-spaced grid row — no stacking, no skew.
  if (reduced) {
    return (
      <div
        className="dc-flat"
        style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
      >
        {shown.map((c) => (
          <Card key={c.id} card={c} depth={0} reduced />
        ))}
      </div>
    );
  }

  // Skew-stack. The host reserves enough height for the deepest card's
  // right+down offset (each step nudges ~40px down). Front card = index 0,
  // highest z-index; later cards recede (data-depth grows).
  return (
    <div
      className="dc-stack"
      style={{ minHeight: 150 + (n - 1) * 48 } as CSSProperties}
    >
      {shown.map((c, i) => (
        <Card key={c.id} card={c} depth={i} reduced={false} z={n - i} />
      ))}
    </div>
  );
}

function Card({
  card,
  depth,
  reduced,
  z,
}: {
  card: DisplayCard;
  depth: number;
  reduced: boolean;
  z?: number;
}) {
  return (
    <div
      className="dc-card bg-card cursor-pointer px-5 py-4"
      data-depth={depth}
      style={z !== undefined ? ({ zIndex: z } as CSSProperties) : undefined}
      onClick={card.onOpen}
      onPointerMove={reduced ? undefined : igniteBorder}
      onPointerLeave={reduced ? undefined : douseBorder}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          card.onOpen();
        }
      }}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-white/90">{card.title}</div>
          <div className="hud mt-1.5 truncate text-[10px] tracking-[0.16em] text-white/40">
            {card.subtitle}
          </div>
        </div>
        <button
          aria-label="unpin"
          onClick={(e) => {
            e.stopPropagation();
            card.onUnpin();
          }}
          className="dc-star relative z-10 rounded-md p-1 text-[var(--ac)] transition-colors hover:text-white"
        >
          <Star size={15} fill="currentColor" strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}
