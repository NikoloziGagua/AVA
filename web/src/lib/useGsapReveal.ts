import { useRef } from "react";
import { gsap, shouldReduceMotion, useGSAP } from "./gsap.js";

export function useGsapReveal(dependencies: unknown[] = []) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    if (!scope.current || shouldReduceMotion()) return;

    const targets = gsap.utils.toArray<HTMLElement>("[data-gsap-reveal]", scope.current);
    if (targets.length === 0) return;

    gsap.fromTo(
      targets,
      { autoAlpha: 0, y: 18, filter: "blur(10px)" },
      {
        autoAlpha: 1,
        y: 0,
        filter: "blur(0px)",
        duration: 0.72,
        stagger: 0.055,
        ease: "power3.out",
      },
    );
  }, { scope, dependencies });

  return scope;
}
