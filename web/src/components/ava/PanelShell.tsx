import { useRef, type ReactNode } from "react";
import { gsap, useGSAP } from "../../lib/gsap.js";

const PANEL_BG =
  "radial-gradient(ellipse 70% 80% at 50% 0%, rgba(92,242,255,0.10), transparent 60%)," +
  "radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px) 0 0 / 28px 28px, #000";

/**
 * Shared chrome for the deck panels (Memory / Rules / Self). Centers content in a
 * readable max-width column (so it doesn't stretch edge-to-edge on a wide desktop),
 * leaves room up top for the persistent TubelightNav, renders a page title, and
 * GSAP-staggers its sections in on open. Mark each top-level block with
 * `data-panel-section` to join the cascade.
 */
export function PanelShell({ title, children }: { title: string; children: ReactNode }) {
  const scope = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      gsap.from("[data-panel-section]", {
        y: 22,
        opacity: 0,
        duration: 0.5,
        ease: "power3.out",
        stagger: 0.07,
        clearProps: "transform,opacity",
      });
    },
    { scope },
  );

  return (
    <div ref={scope} className="no-scrollbar relative h-full overflow-y-auto text-white" style={{ background: PANEL_BG }}>
      <div className="mx-auto w-full max-w-3xl px-6 pt-28 pb-20">
        <h1
          data-panel-section
          className="hud mb-7 text-[26px] font-semibold tracking-[0.12em] text-transparent bg-clip-text"
          style={{ backgroundImage: "linear-gradient(180deg,#fff,rgba(255,255,255,.55))" }}
        >
          {title}
        </h1>
        {children}
      </div>
    </div>
  );
}

/**
 * A titled block inside a PanelShell — the card-like section the deck panels use.
 * Auto-joins the GSAP open cascade.
 */
export function PanelSection({ title, right, onClickHeader, children }: {
  title: string;
  right?: ReactNode;
  onClickHeader?: () => void;
  children: ReactNode;
}) {
  return (
    <section
      data-panel-section
      className="mb-4 rounded-2xl border border-white/8 bg-white/[0.02] px-5 py-4 backdrop-blur-sm"
    >
      <header
        className={"hud mb-3 flex items-center justify-between text-xs tracking-wider text-white/55 " + (onClickHeader ? "cursor-pointer" : "")}
        onClick={onClickHeader}
      >
        <span>{title}</span>
        {right}
      </header>
      {children}
    </section>
  );
}
