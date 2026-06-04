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

gsap.registerPlugin(useGSAP, Flip, MorphSVGPlugin, DrawSVGPlugin, ScrambleTextPlugin);

export { gsap, useGSAP, Flip };
