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
import { CustomEase } from "gsap/CustomEase";

gsap.registerPlugin(useGSAP, Flip, MorphSVGPlugin, DrawSVGPlugin, ScrambleTextPlugin, SplitText, CustomEase);

// The deck authored its signature ease as the CSS curve cubic-bezier(0.22,1,0.36,1),
// but GSAP core CANNOT parse a raw `cubic-bezier(...)` string — so every `ease: EASE`
// tween (buildPanelEnter, Composer, MessageList, MemoryScreen, DisplayCards, …) was
// silently falling back to the default power ease. Registering it as a real CustomEase
// named "cinematic" makes the intended curve actually apply. The SVG path
// "M0,0 C0.22,1 0.36,1 1,1" is the exact bezier of cubic-bezier(.22,1,.36,1); deckMotion's
// EASE now points at this name (the literal CSS curve still lives in theme.css).
CustomEase.create("cinematic", "M0,0 C0.22,1 0.36,1 1,1");

// ScrollTrigger.register() enables the plugin, which calls gsap.matchMedia() →
// window.matchMedia(). jsdom (our component test env) defines `window` but NOT
// matchMedia, so registering there throws. Register only in a real browser; the
// ScrollTrigger object is still exported and usable when registered. Tests never
// render ScrollTrigger-driven UI, so skipping registration there is harmless.
if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  gsap.registerPlugin(ScrollTrigger);
}

export { gsap, useGSAP, Flip, ScrollTrigger, SplitText, CustomEase };
