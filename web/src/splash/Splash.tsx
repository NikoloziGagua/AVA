import { useEffect, useRef } from "react";
import { PathsBackground } from "../components/ava/PathsBackground.js";
import { gsap, shouldReduceMotion, useGSAP } from "../lib/gsap.js";

export function Splash({ onDone }: { onDone: () => void }) {
  const scope = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setTimeout(onDone, 1800);
    return () => clearTimeout(id);
  }, [onDone]);

  useGSAP(() => {
    if (!scope.current || shouldReduceMotion()) return;

    const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
    tl.from(".splash-rule", { scaleX: 0, transformOrigin: "center", duration: 0.9 })
      .from(".splash-kicker", { autoAlpha: 0, y: 10, filter: "blur(10px)", duration: 0.55 }, "-=0.45")
      .from(".splash-letter", { autoAlpha: 0, yPercent: 80, rotateX: -45, stagger: 0.08, duration: 0.72 }, "-=0.2")
      .from(".splash-caption", { autoAlpha: 0, y: 12, filter: "blur(8px)", duration: 0.56 }, "-=0.22")
      .to(".splash-crest", { scale: 0.86, autoAlpha: 0, filter: "blur(16px)", duration: 0.55, delay: 0.25 });
  }, { scope });

  return (
    <div ref={scope} className="ava-luxe-screen">
      <div className="absolute inset-0 opacity-35">
        <PathsBackground opacity={1} />
      </div>
      <div className="absolute inset-x-8 top-1/2 z-10 -translate-y-1/2">
        <div className="splash-crest mx-auto flex max-w-[520px] flex-col items-center text-center">
          <div className="splash-rule mb-8 h-px w-full bg-gradient-to-r from-transparent via-[var(--ava-champagne)] to-transparent" />
          <div className="splash-kicker ava-kicker mb-5">private atelier</div>
          <h1 className="ava-metal-wordmark text-[76px] font-semibold leading-none sm:text-[112px]">
            {"Ava".split("").map((ch) => (
              <span key={ch} className="splash-letter inline-block">
                {ch}
              </span>
            ))}
          </h1>
          <p className="splash-caption mt-6 max-w-[310px] text-xs leading-6 text-[var(--ava-fg-muted)]">
            Executive intelligence, tuned for your desktop.
          </p>
          <div className="splash-rule mt-8 h-px w-full bg-gradient-to-r from-transparent via-[var(--ava-cobalt)] to-transparent" />
        </div>
      </div>
    </div>
  );
}
