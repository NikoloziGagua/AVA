import { useRef, type CSSProperties } from "react";
import { Star } from "lucide-react";
import { gsap, useGSAP } from "../../lib/gsap.js";
import { useReducedMotion } from "../../lib/useReducedMotion.js";
import { EASE, D } from "../../lib/deckMotion.js";
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

/** How many cards we lay out in the physical fanned stack (the rest stay logical). */
const MAX_FANNED = 4;

/**
 * "Important chats" cluster — a taste-driven adaptation of the owner's DisplayCards,
 * recolored into the cyan/mercury deck.
 *
 * RESTING STATE: up to four `.bg-card` glass slabs are stacked on top of one another,
 * each one nudged down/right and rotated a few degrees more than the last, so the pile
 * reads as a gently skewed fan of cards (newest on top, depth-cued by a darkening
 * brightness ramp). Only the leading edge of the cards behind peeks out.
 *
 * HOVER: GSAP spreads the pile — each card slides to its own column and un-rotates to
 * flat, so all of them are readable side by side. On leave it collapses back to the
 * fan. Nothing animates at rest; the spread is purely interaction-driven.
 *
 * REDUCED MOTION: no skew, no GSAP. The cards park as a neat, flat, evenly-spaced row
 * (a CSS grid), every card fully readable, no transforms.
 *
 * Each card shows the chat title, a `.hud` last-active subtitle, and a LIT cyan star
 * that unpins (stopPropagation). Clicking the card body opens the chat.
 */
export function DisplayCards({ cards }: DisplayCardsProps) {
  const reduced = useReducedMotion();
  const scope = useRef<HTMLDivElement>(null);
  const shown = cards.slice(0, MAX_FANNED);
  const n = shown.length;

  // Fan geometry: index 0 is the BACK of the pile, the last index is the front/top.
  // Each step forward nudges the card down + right and rotates it a touch more, so the
  // stack fans toward the bottom-right. Spread targets line the cards up in a flat row.
  const geom = (i: number) => {
    const depth = n - 1 - i; // 0 = front card, grows toward the back
    return {
      restX: i * 26,
      restY: i * 18,
      restRot: (i - (n - 1) / 2) * 5,
      restScale: 1 - depth * 0.04,
      restBright: 1 - depth * 0.12,
      // Spread: even columns across the row, flat, full size/brightness.
      spreadX: n > 1 ? (i / (n - 1)) * 100 : 0, // percent of the spread track
    };
  };

  useGSAP(
    () => {
      if (reduced) return;
      // Park every card at its resting fan pose (so initial paint matches the fan).
      const cardsEls = gsap.utils.toArray<HTMLElement>(".dc-card");
      cardsEls.forEach((el, i) => {
        const g = geom(i);
        gsap.set(el, {
          x: g.restX,
          y: g.restY,
          rotation: g.restRot,
          scale: g.restScale,
          filter: `brightness(${g.restBright})`,
          zIndex: i + 1,
        });
      });
    },
    { scope, dependencies: [reduced, n] },
  );

  function spread(on: boolean) {
    if (reduced) return;
    const host = scope.current;
    if (!host) return;
    const track = host.clientWidth;
    const cardsEls = gsap.utils.toArray<HTMLElement>(".dc-card", host);
    cardsEls.forEach((el, i) => {
      const g = geom(i);
      gsap.to(el, {
        x: on ? (g.spreadX / 100) * Math.max(track - 240, 0) : g.restX,
        y: on ? 0 : g.restY,
        rotation: on ? 0 : g.restRot,
        scale: on ? 1 : g.restScale,
        filter: `brightness(${on ? 1 : g.restBright})`,
        duration: on ? D.section : D.screen,
        ease: on ? EASE : "power3.out",
      });
    });
  }

  if (n === 0) return null;

  // Reduced motion: a neat, flat, evenly-spaced grid row — no stacking, no skew.
  if (reduced) {
    return (
      <div
        ref={scope}
        className="grid gap-4"
        style={{ gridTemplateColumns: `repeat(${Math.min(n, MAX_FANNED)}, minmax(0, 1fr))` }}
      >
        {shown.map((c) => (
          <Card key={c.id} card={c} reduced />
        ))}
      </div>
    );
  }

  return (
    <div
      ref={scope}
      className="dc-stack"
      onMouseEnter={() => spread(true)}
      onMouseLeave={() => spread(false)}
      style={{ height: 96 + (n - 1) * 18 } as CSSProperties}
    >
      {shown.map((c) => (
        <Card key={c.id} card={c} reduced={false} />
      ))}
    </div>
  );
}

function Card({ card, reduced }: { card: DisplayCard; reduced: boolean }) {
  return (
    <div
      className={"dc-card bg-card cursor-pointer px-5 py-4" + (reduced ? " relative" : "")}
      onClick={card.onOpen}
      onPointerMove={igniteBorder}
      onPointerLeave={douseBorder}
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
