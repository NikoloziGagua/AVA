// Central GSAP setup. Import { gsap, useGSAP, Flip } from here — never register
// plugins ad hoc in components, so registration happens exactly once.
//
// All plugins below (including the former "Club" bonus plugins) ship free in the
// public `gsap` package post-Webflow acquisition (v3.13+). Verified present in
// node_modules/gsap at install time.
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { Flip } from "gsap/Flip";
import { MorphSVGPlugin } from "gsap/MorphSVGPlugin";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

gsap.registerPlugin(useGSAP, Flip, MorphSVGPlugin, DrawSVGPlugin, ScrambleTextPlugin, SplitText);

// ScrollTrigger.register() enables the plugin, which calls gsap.matchMedia() →
// window.matchMedia(). jsdom (our component test env) defines `window` but NOT
// matchMedia, so registering there throws. Register only in a real browser; the
// ScrollTrigger object is still exported and usable when registered. Tests never
// render ScrollTrigger-driven UI, so skipping registration there is harmless.
if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  gsap.registerPlugin(ScrollTrigger);
}

export { gsap, useGSAP, Flip, ScrollTrigger, SplitText };
