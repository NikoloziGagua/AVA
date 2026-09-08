import { useEffect, useRef } from "react";
import { Radar } from "lucide-react";
import { DottedSurface } from "../components/ava/DottedSurface.js";
import { NebulaBackground } from "../components/ava/NebulaBackground.js";
import { Orb } from "../components/ava/Orb.js";
import { CommandBar } from "../chat/CommandBar.js";
import { isCoarsePointer } from "../lib/media.js";
import { gsap, useGSAP } from "../lib/gsap.js";
import { EASE } from "../lib/deckMotion.js";
import { useReducedMotion } from "../lib/useReducedMotion.js";

export interface OrbitScreenProps {
  /** Submit from the command bar → open a new chat seeded with this text. */
  onCommand: (text: string) => void;
  onEnterVoice: () => void;
  onExplore: () => void;
}

function isTypingTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}

/**
 * Home — de-spun. No orbital ring, no rotating chat nodes. The moving
 * DottedSurface + Nebula behind a glass tubelight nav, the mercury Orb hero, the
 * AVA wordmark, and a command bar. Press Space (or click the orb) to talk.
 */
export function OrbitScreen({ onCommand, onEnterVoice, onExplore }: OrbitScreenProps) {
  // Touch devices have no spacebar (and Space is a press, not a hold) — the
  // hint must say what's actually true for the device in hand.
  const touch = isCoarsePointer();
  const reduced = useReducedMotion();
  // The command-bar rail widens while the bar is focused (CommandBar ignites its
  // own glow; the home stretches the stage under it). Width tween on ONE element,
  // driven by a focus boolean — never per-frame state.
  const railRef = useRef<HTMLDivElement>(null);
  const { contextSafe } = useGSAP({ scope: railRef });
  const onBarFocus = contextSafe((focused: boolean) => {
    if (!railRef.current) return;
    if (reduced) {
      gsap.set(railRef.current, { width: focused ? 580 : 460 });
      return;
    }
    // `y` is already a compositor transform. `width` stays a layout tween (not
    // transform:scaleX): the rail's only child is CommandBar's rounded pill, and
    // scaleX would visibly distort its corners/border/text through the whole
    // 0.55s tween. Because this rail is position:absolute (out of flow), the
    // width change reflows only its own small subtree, never the page — so the
    // per-frame cost is contained and the trade favors no distortion here.
    gsap.to(railRef.current, {
      width: focused ? 580 : 460,
      y: focused ? -6 : 0,
      duration: 0.55,
      ease: EASE,
    });
  });
  // Space anywhere (when not typing) → voice.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat && !isTypingTarget(e)) {
        e.preventDefault();
        onEnterVoice();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEnterVoice]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      <DottedSurface />
      <NebulaBackground />
      {/* vignette to lift the orb */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 46%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 70%, rgba(0,0,0,0.85) 100%)",
        }}
      />

      {/* Hero nudged above dead-center (top-[46%]) and the command bar raised
          (bottom-28) so the two read as one grouped hero instead of a stray bar
          orphaned at the very bottom edge on the 1440×900 desktop target. */}
      <div className="absolute left-1/2 top-[46%] z-20 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
        <div className="hud mb-4 text-[10px] text-white/40">I AM</div>
        <button onClick={onEnterVoice} aria-label="speak to Ava" className="cursor-pointer">
          <Orb size={150} state="idle" flipId="ava-orb" />
        </button>
        <div
          className="mt-5 bg-clip-text text-5xl font-semibold tracking-[0.34em] text-transparent"
          style={{ backgroundImage: "linear-gradient(180deg,#fff,rgba(255,255,255,.5))" }}
        >
          AVA
        </div>
        <div className="hud mt-3 text-[10px] text-white/45">
          {touch ? (
            <>TAP THE <span style={{ color: "var(--ac)" }}>ORB</span> TO SPEAK · OR TYPE</>
          ) : (
            <>PRESS <span style={{ color: "var(--ac)" }}>SPACE</span> TO SPEAK · OR TYPE</>
          )}
        </div>
        <button
          type="button"
          onClick={onExplore}
          className="hud mt-5 flex items-center gap-2 rounded-full border border-[rgba(92,242,255,.16)] bg-[rgba(92,242,255,.055)] px-4 py-2 text-[9px] text-[var(--ac-text)] transition-colors hover:border-[rgba(92,242,255,.35)] hover:bg-[rgba(92,242,255,.10)]"
        >
          <Radar size={13} />
          EXPLORE WHAT AVA CAN DO
        </button>
      </div>

      {/* Centered via auto margins (NOT translateX(-50%)): GSAP's y-tween would
          freeze a translate at the pre-tween pixel value, drifting the bar
          off-center while its width animates. Auto margins re-center every frame. */}
      <div
        ref={railRef}
        className="absolute inset-x-0 bottom-28 z-20 mx-auto max-w-[86%]"
        style={{ width: 460 }}
      >
        <CommandBar onSubmit={onCommand} onFocusChange={onBarFocus} />
      </div>
    </div>
  );
}
