import { useRef, type ReactNode } from "react";
import { useGSAP } from "../../lib/gsap.js";
import { useReducedMotion } from "../../lib/useReducedMotion.js";
import { buildPanelEnter, setPanelStatic } from "../../lib/deckMotion.js";
import { NeuralField } from "./NeuralField.js";
import { BorderGlow } from "./BorderGlow.js";

/**
 * Shared chrome for the deck panels (Chats / Memory / Rules / Self).
 *
 * Lays out a readable column (max-w-5xl) under the persistent TubelightNav, paints
 * the cyan bloom + dot-grid backdrop, renders the title rail (specular sweep +
 * DrawSVG mercury underline + ScrambleText decode), and runs the panel-enter master
 * timeline — or parks to the lit final state under reduced motion.
 *
 * Mark each top-level block with `data-panel-section` (PanelSection does this) to
 * join the stagger cascade.
 *
 * @param grid  when true the content column becomes a 12-col grid; screens place
 *              sections with `span` (e.g. "lg:col-span-5").
 * @param bg    background layer rendered between the black root and the cyan bloom
 *              (so the bloom stays on top of it). Defaults to a prominent NeuralField
 *              neuro shader so EVERY deck panel has an animated background; pass your
 *              own (or null) to override.
 */
export function PanelShell({ title, grid = false, bg, children }: {
  title: string;
  grid?: boolean;
  bg?: ReactNode;
  children: ReactNode;
}) {
  const scope = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  useGSAP(
    () => {
      const root = scope.current;
      if (!root) return;
      if (reduced) { setPanelStatic(root, title); return; }
      buildPanelEnter(root, title);
    },
    { scope, dependencies: [reduced, title] },
  );

  return (
    <div ref={scope} className="no-scrollbar relative h-full overflow-y-auto text-white" style={{ background: "#000" }}>
      {bg === undefined ? <NeuralField opacity={0.4} /> : bg}
      <div
        data-panel-bloom
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 64% 70% at 50% -4%, rgba(92,242,255,.13), transparent 58%)," +
            "radial-gradient(circle, rgba(255,255,255,.05) 1px, transparent 1px) 0 0 / 30px 30px",
        }}
      />
      <div
        data-panel-stage
        className="relative mx-auto w-full max-w-5xl px-8 pt-28 pb-24 will-change-transform"
      >
        <div data-panel-titlewrap className="lg-sweep mb-10">
          <h1
            data-panel-title
            className="hud text-[30px] font-semibold tracking-[0.16em] text-transparent bg-clip-text"
            style={{ backgroundImage: "linear-gradient(180deg,#fff,rgba(255,255,255,.5))" }}
          >
            {title}
          </h1>
          <svg className="mt-4 block w-40 overflow-visible" height="2" aria-hidden>
            <line
              data-title-rule
              x1="0"
              y1="1"
              x2="160"
              y2="1"
              stroke="url(#mercuryRule)"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <defs>
              <linearGradient id="mercuryRule" x1="0" x2="1">
                <stop offset="0" stopColor="#eaf6fa" />
                <stop offset=".5" stopColor="#5cf2ff" />
                <stop offset="1" stopColor="#9fc6d4" stopOpacity="0" />
              </linearGradient>
            </defs>
          </svg>
        </div>
        <div className={grid ? "grid grid-cols-1 lg:grid-cols-12 gap-6 items-start" : ""}>
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * A titled card section inside a PanelShell — the premium `.lg-slab` glass surface.
 * Auto-joins the GSAP open cascade (and its per-section specular sweep) via
 * `data-panel-section`.
 *
 * @param right         optional right-aligned header slot (buttons / counts).
 * @param onClickHeader makes the header a clickable disclosure (adds cursor).
 * @param span          grid-column classes when the parent PanelShell uses `grid`
 *                      (e.g. "lg:col-span-5"). Ignored in non-grid shells.
 */
export function PanelSection({ title, right, onClickHeader, span, children }: {
  title: string;
  right?: ReactNode;
  onClickHeader?: () => void;
  span?: string;
  children: ReactNode;
}) {
  return (
    <BorderGlow dataPanelSection className={"mb-6 px-6 py-5 " + (span ?? "")}>
      <header
        className={
          "hud mb-4 flex items-center justify-between text-[11px] tracking-[0.18em] text-white/60 " +
          (onClickHeader ? "cursor-pointer" : "")
        }
        onClick={onClickHeader}
      >
        <span className="flex items-center gap-2">
          <span
            className="h-1 w-1 rounded-full"
            style={{ background: "var(--ac)", boxShadow: "0 0 6px rgba(92,242,255,.8)" }}
          />
          {title}
        </span>
        {right}
      </header>
      {children}
    </BorderGlow>
  );
}
