# Ava Premium Frontend Remodel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the entire Ava PWA to the approved premium/GSAP aesthetic (liquid mercury orb, cyan command-deck, nebula+dots home, falling-rain chat with collapsible Activity panel + working mode, cinematic voice) with **zero backend/behavior changes**.

**Architecture:** New shared visual primitives (`Orb`, backgrounds, `TubelightNav`, `ActivityPanel`, `MessageActions`) + GSAP foundation; existing screens reskinned to consume them. The mercury orb is one logical element that GSAP-Flips between home ↔ chat ↔ voice. All data flows (`useChatStream`, `useRealtimeVoice`, SSE events) are untouched.

**Tech Stack:** React 19, Vite 7, Tailwind 4, `motion/react` (existing), **gsap + @gsap/react** (new, all plugins free post-Webflow), three.js (existing `DottedSurface`), vitest.

**Spec:** `docs/superpowers/specs/2026-06-04-ava-premium-frontend-remodel-design.md`

---

## Conventions

- TDD where there's pure logic (state mapping, collapse state, nav active, action handlers). Visual components get **smoke tests** (render without crashing) matching the existing `*.smoke.test.tsx` pattern.
- Run `npm -w web run test` and `npm -w web run build` after each phase. Commit per task.
- Respect `useReducedMotion` in every animated component.
- Don't delete a retired component until all imports are migrated (grep first).

---

## Phase 1 — GSAP foundation + visual primitives

### Task 1.1: Install GSAP

**Files:** Modify `web/package.json`

- [ ] **Step 1:** From repo root: `npm -w web install gsap @gsap/react`
- [ ] **Step 2:** Verify `gsap` + `@gsap/react` appear in `web/package.json` dependencies.
- [ ] **Step 3:** `npm -w web run build` → expect clean.
- [ ] **Step 4:** Commit: `feat(web): add gsap + @gsap/react`

### Task 1.2: GSAP registration module

**Files:** Create `web/src/lib/gsap.ts`

- [ ] **Step 1:** Write the module:

```ts
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { Flip } from "gsap/Flip";
import { MorphSVGPlugin } from "gsap/MorphSVGPlugin";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";

gsap.registerPlugin(useGSAP, Flip, MorphSVGPlugin, DrawSVGPlugin, ScrambleTextPlugin);

export { gsap, useGSAP, Flip };
```

- [ ] **Step 2:** `npm -w web run build` → clean (confirms plugin paths resolve).
- [ ] **Step 3:** Commit: `feat(web): register gsap plugins`

### Task 1.3: Theme tokens

**Files:** Modify `web/src/theme.css`

- [ ] **Step 1:** Add the new palette + helpers (keep existing tokens; add):

```css
:root {
  --ac: #5cf2ff;            /* cyan accent (lead) */
  --ac-live: #39ffb0;       /* live/success */
  --ac-exec: #ffd479;       /* executing */
  --ac-stop: #ff6b6b;       /* stop/destructive */
  --glass: rgba(12,15,22,.6);
  --glass-border: rgba(255,255,255,.1);
  --font-mono: ui-monospace, Menlo, monospace;
}
.hud { font-family: var(--font-mono); text-transform: uppercase; letter-spacing: .18em; }
.glass { background: var(--glass); border: 1px solid var(--glass-border); backdrop-filter: blur(16px); }
.mercury { background: conic-gradient(from 180deg,#eaf6fa,#9fc6d4,#4f7e8c,#d6eef4,#7ba8b6,#f0fbff,#86b3c0,#eaf6fa); }
```

- [ ] **Step 2:** Commit: `feat(web): premium theme tokens`

### Task 1.4: `Orb` component (mercury, stateful)

**Files:** Create `web/src/components/ava/Orb.tsx`, Create `web/src/components/ava/Orb.smoke.test.tsx`, Create `web/src/components/ava/orb-state.ts`, Create `web/src/components/ava/orb-state.test.ts`

- [ ] **Step 1 (test first):** `orb-state.test.ts` — pure mapping from state → motion params:

```ts
import { describe, it, expect } from "vitest";
import { orbMotion } from "./orb-state.js";
it("idle is calm, working/thinking churn faster", () => {
  expect(orbMotion("idle").spin).toBeGreaterThan(orbMotion("thinking").spin); // higher = slower
  expect(orbMotion("responding").rimOpacity).toBeGreaterThan(orbMotion("idle").rimOpacity);
});
it("listening scales rim with amplitude", () => {
  expect(orbMotion("listening", 1).rimOpacity).toBeGreaterThan(orbMotion("listening", 0).rimOpacity);
});
```

- [ ] **Step 2:** Implement `orb-state.ts`:

```ts
export type OrbState = "idle" | "listening" | "thinking" | "responding" | "working";
export interface OrbMotion { spin: number; morph: number; rimOpacity: number; }
export function orbMotion(state: OrbState, amplitude = 0): OrbMotion {
  switch (state) {
    case "listening":  return { spin: 16, morph: 7,   rimOpacity: 0.5 + amplitude * 0.5 };
    case "thinking":   return { spin: 6,  morph: 3,   rimOpacity: 0.8 };
    case "working":    return { spin: 5,  morph: 3,   rimOpacity: 0.85 };
    case "responding": return { spin: 7,  morph: 3.5, rimOpacity: 1 };
    default:           return { spin: 18, morph: 7,   rimOpacity: 0.55 };
  }
}
```

- [ ] **Step 3:** `npm -w web run test -- orb-state` → PASS.
- [ ] **Step 4:** Implement `Orb.tsx` (CSS mercury core + cyan rim + highlight; GSAP rotation/morph timeline keyed off `orbMotion`; ripple spawn on `state==="listening"` via amplitude; honor reduced-motion → static). Accept `size`, `state`, `amplitude`, `flipId`.
- [ ] **Step 5:** `Orb.smoke.test.tsx` — renders each state without crashing.
- [ ] **Step 6:** `npm -w web run test` + `build` → green. Commit: `feat(web): mercury Orb component`

### Task 1.5: `NebulaBackground`

**Files:** Create `web/src/components/ava/NebulaBackground.tsx` + smoke test

- [ ] **Step 1:** Drifting nebula glow (CSS radial gradients + GSAP/CSS drift), absolute inset, `aria-hidden`, reduced-motion → static. Pairs above `DottedSurface`.
- [ ] **Step 2:** Smoke test. `test` + `build` green. Commit: `feat(web): NebulaBackground`

### Task 1.6: `RainBackground`

**Files:** Create `web/src/components/ava/RainBackground.tsx` + smoke test

- [ ] **Step 1:** Falling light-rain (radial streak gradients animated downward) + frosted dotted veil + scrim; reduced-motion → static dim. `aria-hidden`.
- [ ] **Step 2:** Smoke test. `test` + `build` green. Commit: `feat(web): RainBackground`

---

## Phase 2 — Home screen (de-spin + new composition)

### Task 2.1: `TubelightNav`

**Files:** Create `web/src/components/ava/TubelightNav.tsx`, `TubelightNav.smoke.test.tsx`, `tubelight-nav.ts` (+ test)

- [ ] **Step 1 (test):** pure active-index resolver in `tubelight-nav.ts` (given items + activeName → index; default 0).
- [ ] **Step 2:** Implement nav: glass pill, items `{name, icon, onSelect}`; active item shows the sliding lamp via `motion/react` `layoutId="ava-lamp"` + cyan glow (adapt user's NavBar). Labels shown on desktop, icons always.
- [ ] **Step 3:** Smoke test renders 5 items; clicking fires `onSelect`. `test`+`build`. Commit: `feat(web): TubelightNav`

### Task 2.2: HomeScreen — strip orbital, new layout

**Files:** Modify `web/src/orbit/OrbitScreen.tsx` (rename export to `HomeScreen`, keep file or move to `home/HomeScreen.tsx`), Modify `web/src/App.tsx`

- [ ] **Step 1:** Remove dashed ring, rotating tool ring, orbiting `OrbitNode`s, `useOrbitRotation`, long-press. Keep `DottedSurface`; add `NebulaBackground`.
- [ ] **Step 2:** Compose: `TubelightNav` (top), "I AM" kicker + `Orb state="idle"` hero + "AVA" wordmark, `CommandBar` (Task 2.3), hold-Space/click-orb → `onEnterVoice`.
- [ ] **Step 3:** Wire nav items to existing `App.tsx` callbacks (New→onOpenChat(null), Chats→onOpenList, Memory/Rules/Self→panels).
- [ ] **Step 4:** Update/repair `OrbitScreen.smoke.test.tsx` for the new structure (no orbit nodes). Remove now-dead `OrbitNode`/`useOrbitRotation`/`OrbitRing` + their tests **only after** grep shows no imports.
- [ ] **Step 5:** `test`+`build` green. Commit: `feat(web): de-spun premium HomeScreen`

### Task 2.3: `CommandBar`

**Files:** Create `web/src/chat/CommandBar.tsx` (+ smoke test)

- [ ] **Step 1:** Glass omnibox; on submit calls `onSubmit(text)` → HomeScreen opens chat with that seed (reuse `api.sendMessage` path via opening ChatScreen with an initial message). GSAP focus animation.
- [ ] **Step 2:** Smoke test. `test`+`build`. Commit: `feat(web): home command bar`

---

## Phase 3 — Chat

### Task 3.1: Composer — fix overlap + Voice button

**Files:** Modify `web/src/chat/Composer.tsx`, `web/src/chat/ChatScreen.tsx`

- [ ] **Step 1:** Make composer a flex-bottom bar; ensure `MessageList` scroll area has bottom padding so the last line clears it (fixes "covered" bug).
- [ ] **Step 2:** Add Voice button (pulsing mini-`Orb`, label "Voice") → `onEnterVoice`. Send becomes STOP when `busy` (existing `kill`).
- [ ] **Step 3:** Update Composer smoke test (voice button present). `test`+`build`. Commit: `fix(web): composer no longer covers last message + voice button`

### Task 3.2: `MessageActions`

**Files:** Create `web/src/chat/MessageActions.tsx`, `message-actions.ts` (+ test)

- [ ] **Step 1 (test):** pure handlers — `copy(text)` returns text; `retry()` calls provided callback; like/dislike toggle local state.
- [ ] **Step 2:** Component: row of Retry / Copy / Like / Dislike / Share under Ava messages; wired (Retry re-sends the prior user turn, Copy → clipboard).
- [ ] **Step 3:** Render in `MessageList` under assistant/final messages. Reskin user bubble + Ava mini-orb avatar. `test`+`build`. Commit: `feat(web): chat message actions`

### Task 3.3: `ActivityPanel` (collapsible side-to-side)

**Files:** Create `web/src/chat/ActivityPanel.tsx`, `activity-steps.ts` (+ test), Modify `MessageList.tsx`/`ChatScreen.tsx`

- [ ] **Step 1 (test):** `activity-steps.ts` — derive ordered steps `{label, status: done|running|queued, ms?}` from the live `StreamEvent[]` (tool_call→running, tool_result→done, thoughts→note). Pure, tested.
- [ ] **Step 2:** Panel: right-docked glass list of steps + "Now:" + progress bar; collapse `⟩` slides it out (GSAP), collapsed tab `⟨` + live count reopens. Store collapsed state (local, persisted to localStorage).
- [ ] **Step 3:** Wire into ChatScreen body row; conversation flexes when collapsed. `test`+`build`. Commit: `feat(web): collapsible chat activity panel`

### Task 3.4: Working / executing mode

**Files:** Modify `ChatScreen.tsx`, `RainBackground.tsx`

- [ ] **Step 1 (test):** extend the existing `headerState` logic / add `isExecuting` derive (true when current run has an unresolved tool_call) — pure, tested.
- [ ] **Step 2:** When executing: charge the rain (speed/brightness prop), show scanline + amber frame + corner ticks, header `EXECUTING · <tool>`, auto-expand ActivityPanel, composer STOP. Ease back on done.
- [ ] **Step 3:** `test`+`build`. Commit: `feat(web): chat working/executing mode`

---

## Phase 4 — Voice

### Task 4.1: VoiceScreen reskin

**Files:** Modify `web/src/voice/VoiceScreen.tsx`, `voice-state.ts` (+ test)

- [ ] **Step 1 (test):** pure `voiceStateLabel`/`voiceTint` mapping (keep existing labels) extracted + tested.
- [ ] **Step 2:** Replace `Pulse` with `Orb` (big, state-mapped, `flipId`); cyan amplitude ripples on listening; nebula+dots bg + per-state tint; captions blur-in (keep `caption`); keep approval card (verbal hint added); controls mute/interrupt/keyboard; working readout chip → opens ActivityPanel.
- [ ] **Step 3:** Update VoiceScreen tests. `test`+`build`. Commit: `feat(web): cinematic voice mode`

---

## Phase 5 — Transitions + splash

### Task 5.1: GSAP Flip orb across surfaces

**Files:** Modify `web/src/App.tsx`, `Orb.tsx`

- [ ] **Step 1:** Give the orb a stable `flipId`; on view change (home↔chat↔voice) capture Flip state and animate the orb between hero/mini/hero. Fallback to fade if reduced-motion.
- [ ] **Step 2:** Manual verify continuity. `build`. Commit: `feat(web): orb flips between surfaces`

### Task 5.2: Splash

**Files:** Modify `web/src/splash/Splash.tsx`

- [ ] **Step 1:** Orb forms (scale/blur-in) + SplitText "AVA", then hands off (Flip) to home hero. Reduced-motion → quick fade. `build`. Commit: `feat(web): cinematic splash`

---

## Phase 6 — Panels reskin

### Task 6.1: Memory / Rules / Self / Chats list / Pairing

**Files:** Modify `web/src/memory/MemoryScreen.tsx`, `web/src/rules/RulesScreen.tsx`, `web/src/self/SelfScreen.tsx`, `web/src/orbit/ChatListScreen.tsx`, `web/src/auth/PairingScreen.tsx`

- [ ] **Step 1:** Apply glass + mono labels + cyan + corner-tick headers; keep all functionality. Move chat delete/undo into ChatListScreen.
- [ ] **Step 2:** Keep existing smoke tests passing. `test`+`build`. Commit: `feat(web): reskin panels`

---

## Phase 7 — Polish, reduced-motion, final verify

### Task 7.1: Reduced-motion + perf pass

- [ ] **Step 1:** Verify every animated component collapses under `prefers-reduced-motion`; no infinite loops; orb static.
- [ ] **Step 2:** Retire `Pulse` (forward to `Orb` or delete after grep shows no imports).

### Task 7.2: Full verify

- [ ] **Step 1:** `npm -w web run test` (all green, including new tests).
- [ ] **Step 2:** `npm -w web run build` clean.
- [ ] **Step 3:** Manual checklist (home no-spin + nav lamp + command bar + hold-space voice; chat actions + fixed composer + activity collapse + working mode + voice button; voice ripples + captions + interrupt + verbal approval; orb flips; panels).
- [ ] **Step 4:** Commit + open PR from the remodel branch.

---

## Self-review notes

- **Spec coverage:** every spec section maps to a phase (1: foundation/orb/bg; 2: home; 3: chat; 4: voice; 5: transitions/splash; 6: panels; 7: polish). ✓
- **Type consistency:** `OrbState`/`orbMotion`, `activity-steps` shapes, `TubelightNav` item type are defined once and reused. ✓
- **No backend changes** — all tasks are under `web/`. ✓
- **Risk:** GSAP bonus plugins (`MorphSVGPlugin` etc.) resolve from the npm package post-Webflow; Task 1.2 build-checks this early so we fail fast.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
