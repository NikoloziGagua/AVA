# Ava Premium Frontend Remodel — Design Spec

**Date:** 2026-06-04
**Status:** Approved in brainstorming (visual mockups), pending written-spec review
**Owner:** nikoloz-gagua

## Goal

Re-skin the entire Ava PWA to a premium, animation-forward aesthetic driven heavily by **GSAP**, **without changing any backend behavior or app functionality**. Replace the spinning orbital home with a calm, cinematic command surface; keep the moving dotted background; give chat a live "working" mode and a collapsible activity panel; make voice the cinematic hero. Every existing capability (streaming, tools, approvals, playbooks, hybrid voice, self-improvement) is preserved — only the presentation changes.

## Primary target

**Desktop-primary.** Layouts are designed for the computer first (the user now mostly drives Ava at the desk). It must still function on phone, but big-screen is the design priority. (This supersedes the prior "phone-controlled PWA" framing.)

## Non-goals / out of scope

- No backend/API/route changes. No change to `server/`.
- No change to the agent, tools, voice transport, or self-improvement logic.
- No new app features beyond what's listed here (message actions, working mode, collapsible activity, voice button are UI surfacing of existing data).
- Not a marketing/landing site — "landing page" = the app's home/entry surface.

---

## 1. Design language (locked)

### Color & material
- **Background:** near-black `#04050a` / `#050507`.
- **Accent:** cyan `#5cf2ff` (primary). Green `#39ffb0` for "live/success", amber `#ffd479` for "executing", red `#ff6b6b` for stop/destructive.
- **Orb:** liquid **mercury chrome** — `conic-gradient(from 180deg, #eaf6fa,#9fc6d4,#4f7e8c,#d6eef4,#7ba8b6,#f0fbff,#86b3c0,#eaf6fa)` with a cyan rim glow and a soft white highlight. Morphs (border-radius) + slow rotation; speed eased per state.
- **Glass:** `rgba(12,15,22,.5–.66)` + `backdrop-filter: blur(14–20px)` + hairline `rgba(255,255,255,.09–.12)` borders. Corner ticks (command-deck) used as an "active" frame accent.
- Keep existing purple/blue `--ava-*` tokens but re-point usage to the new palette; cyan becomes the lead.

### Type
- UI / body: existing system sans.
- **HUD / labels / status / steps / chips:** monospace (`ui-monospace, Menlo, monospace`), uppercase, wide letter-spacing (`.16–.22em`).
- Wordmark "AVA": 600 weight, `.34em` tracking, white→translucent vertical gradient.

### Motion personality
- Weighty, smooth, confident. GSAP-driven. The orb is always subtly alive.
- "A lot of GSAP" is an explicit requirement — animation is the backbone, not a sprinkle.

### Backgrounds (per surface)
- **Home:** keep the real three.js **`DottedSurface`** (moving dot-wave) + a drifting **nebula** glow above it. (Approved: "B · dots + nebula".)
- **Chat:** **falling light-rain** — vertical light streaks raining behind a fine frosted dotted veil, dimmed under a scrim for legibility. (Approved "B".)
- **Voice:** the home nebula + dots, immersive, with a per-state radial tint.
- (Rejected: "Etheral Shadows" turbulence background — kept on file, not used.)

---

## 2. GSAP foundation

- Install `gsap` + `@gsap/react` into `web/`. All plugins are now free post-Webflow.
- New `web/src/lib/gsap.ts`: import + `gsap.registerPlugin(useGSAP, Flip, MorphSVGPlugin, DrawSVGPlugin, ScrambleTextPlugin, Physics2DPlugin)` once. Export `gsap`, `useGSAP`, `Flip`.
- Use `useGSAP(() => {...}, { scope })` in components for scoped, auto-reverting animations.
- Respect `prefers-reduced-motion` (existing `useReducedMotion`): collapse to fades/instant; orb goes static; no rain/ripple loops.
- Framer `motion/react` stays for layout/`AnimatePresence` route transitions where already used; GSAP owns the new orb, backgrounds, scramble/draw, Flip transitions.

### Signature transition: the traveling orb
The mercury orb is **one logical element** across surfaces. Moving home → voice or home → chat uses **GSAP Flip**: the orb physically translates/resizes from hero (home) → big hero (voice) or → mini avatar (chat header), no hard cut. This replaces the current `layoutId="ava-pulse"` morph.

---

## 3. The Orb (shared centerpiece)

New `web/src/components/ava/Orb.tsx` — replaces `Pulse` as the canonical Ava avatar (keep `Pulse` only if still imported elsewhere during migration, then retire).

- Props: `size`, `state: "idle" | "listening" | "thinking" | "responding" | "working"`, `amplitude?`, `layoutId/flipId`.
- Visual: mercury conic gradient core, morphing border-radius, slow rotation, cyan rim, white highlight.
- State behavior:
  - **idle** — slow breathe/rotate, calm rim.
  - **listening** — amplitude-reactive ripples spawn outward (cyan rings); rim brightens with `amplitude`.
  - **thinking/working** — faster churn (morph + spin), rim pulse.
  - **responding** — brightest rim, medium churn.
- Implementation: CSS for the gradient/highlight; GSAP for rotation/morph timelines and ripple spawning; MorphSVG optional for a true liquid edge (phase 2 polish). Mini version (24–26px) used as chat avatar.

---

## 4. Home screen (`HomeScreen`, from `orbit/OrbitScreen.tsx`)

**Remove:** the dashed inner ring, the rotating tool ring, the orbiting chat-session nodes (`OrbitNode`, `useOrbitRotation`, `OrbitRing` positioning), the long-press-to-voice on the orb. **No rotation anywhere.**

**Keep/replace functions:**
- Moving **DottedSurface** + new **Nebula** layer behind it.
- **Tubelight nav** (top center) — new `web/src/components/ava/TubelightNav.tsx`, adapted from the user's `NavBar` component: glass pill, items = New / Chats / Memory / Rules / Self, with the glowing "lamp" that slides via `layoutId` (`motion/react`) + cyan glow. Items fire the existing `App.tsx` view switch (NOT routing): New→new chat, Chats→list, Memory/Rules/Self→panels.
- **Hero:** "I AM" kicker + mercury **Orb** (idle) + "AVA" gradient wordmark.
- **Command bar** (new): a glass omnibox under the orb — type to start a chat / tell Ava to do something (submits to the same `POST /api/chat` flow, opening chat). "HOLD SPACE TO SPEAK · OR TYPE."
- **Hold Space / click orb → voice** (replaces long-press ring).
- Recent chats: optional subtle strip (keep the data from `fetchSessions`) or fold entirely into the Chats panel — **decision: drop the always-on recents on home; Chats panel owns the list** (less clutter; matches the cinematic home). Delete/undo moves into the Chats list.

**GSAP:** nebula parallax drift, SplitText reveal on "AVA", draw-on accents, the lamp slide, magnetic hover on nav items, command-bar focus animation.

---

## 5. Chat screen (`chat/ChatScreen.tsx` + parts)

Background: **falling rain** + frosted veil + scrim (new `web/src/components/ava/RainBackground.tsx`).

### Messages (`MessageList.tsx`)
- User: glass bubble, right; small avatar (initial).
- Ava: mercury mini-orb avatar + content in a subtle glass container.
- **Message actions** (new `web/src/chat/MessageActions.tsx`) under each Ava reply: **Retry / Copy / Like / Dislike / Share**, wired to real actions (Retry re-runs the turn, Copy copies text, Share/Like/Dislike are local for now). Adapted from the user's `Conversation/Message/Actions` component.
- **Collapsible thinking is dropped as an inline element** — Ava's reasoning + tool steps live ONLY in the side Activity panel (below). (Reverted per user.)

### Activity panel (new `web/src/chat/ActivityPanel.tsx`) — collapsible side-to-side
- Right-docked panel listing Ava's **steps** (the existing tool_call / tool_result / thought stream): done ✓ / running ⟳ / queued ○, with timings, a "Now: …" line, and a progress bar during live runs.
- **Collapses horizontally**: a `⟩` button slides it off to the right (conversation flexes to full width); collapsed state shows a slim right-edge **tab** with a live pulse + count and `⟨` to reopen. GSAP slides the panel + flexes the conversation in one motion.
- Same panel serves live execution and after-the-fact review (reads the run's event history).

### Working / executing mode
When a run is active with tool/computer use, the whole chat **charges up**:
- Rain speeds up + brightens, a **scanline** sweeps, the **frame glows amber**, corner ticks appear, the orb churns, header status → `EXECUTING · <tool>`.
- The Activity panel shows the live step stream (auto-expands on first action; user can collapse).
- Composer send button becomes **STOP** (existing `kill`); placeholder invites "type to add or redirect."
- On completion, everything eases back to calm idle.

### Composer (`Composer.tsx`)
- Glass bar, **flex-positioned at the bottom** so messages scroll *above* it — fixes the "last line covered" bug (message area gets bottom padding = composer height).
- Controls: text field, **Voice button** (pulsing mercury mini-orb labeled "Voice" → enters voice mode, same session), Send (→ STOP when busy).
- Header: back, mini-orb, session title, live mono status, quick icons (list/memory/rules). Empty-state big "I AM AVA" that Flips into the header avatar on first message (keep existing behavior, reskinned).

---

## 6. Voice screen (`voice/VoiceScreen.tsx`)

Immersive full-screen. Background = nebula + dots with a per-state radial **tint** (purple=listening, blue=speaking).

- **Orb** is the hero (Flips up from the home orb), big, reacting per state.
- **Listening:** cyan amplitude **ripples** spawn from the orb (`useMicAmplitude`), state label `LISTENING · m:ss`, your words caption live.
- **Thinking/Speaking:** orb churns + brightens; Ava caption.
- **Captions:** you/Ava (the hybrid path captions), blur-in.
- **Verbal approval:** for risky actions Ava asks out loud and the user answers out loud ("yes"/"no"); a card mirrors it with Approve/Deny (keep existing `pendingApproval` + approve/deny).
- **Working in voice:** a compact glass readout `WORKING · <tool> · n/total · see steps ⟩` that opens the same Activity panel.
- **Controls (bottom):** mute (existing), center = mic-state disk → **interrupt (⏸)** when responding (existing `interrupt`), switch-to-keyboard (existing). Exit top-right, state label top-left.
- Preserve: connecting state, error alert, server-VAD (no end-turn button), hybrid behavior.

---

## 7. Panels & secondary surfaces (re-skin to language)

Apply tokens consistently; keep all functionality:
- **Memory / Rules / Self / Chats(list)** (`memory/`, `rules/`, `self/`, `orbit/ChatListScreen.tsx`): slide-up glass overlay panels on the same dark base, mono section labels, cyan accents, corner-tick headers. Chats list gains the delete/undo moved off home.
- **Splash** (`splash/Splash.tsx`): cinematic intro — the orb forms (scale/blur-in + SplitText "AVA"), then Flips into the home hero position. Replaces the current splash.
- **Pairing** (`auth/PairingScreen.tsx`): reskin to glass + orb, minimal.
- `App.tsx`: keep the view-state switcher; upgrade transitions to GSAP Flip for the orb continuity; keep `AnimatePresence` for panel slides.

---

## 8. File structure (create / modify)

**Create:**
- `web/src/lib/gsap.ts` — plugin registration.
- `web/src/components/ava/Orb.tsx` — mercury orb (+ states, ripples).
- `web/src/components/ava/NebulaBackground.tsx` — drifting nebula glow (pairs with `DottedSurface`).
- `web/src/components/ava/RainBackground.tsx` — falling light-rain + veil + scrim (chat).
- `web/src/components/ava/TubelightNav.tsx` — sliding-lamp nav.
- `web/src/chat/ActivityPanel.tsx` — collapsible side-to-side step list.
- `web/src/chat/MessageActions.tsx` — retry/copy/like/dislike/share row.
- `web/src/chat/CommandBar.tsx` (or reuse Composer) — home omnibox.

**Modify:**
- `web/src/theme.css` — new tokens (cyan lead, mono usage, rain/nebula helpers, reduced-motion).
- `web/src/orbit/OrbitScreen.tsx` → becomes `HomeScreen` (strip orbital/rotation; add nav, orb, command bar). Retire `OrbitNode`, `useOrbitRotation`, `OrbitRing` (or delete if unused after).
- `web/src/chat/{ChatScreen,MessageList,Composer,ToolCallChip}.tsx` — reskin + actions + activity panel wiring + working mode + composer fix + voice button.
- `web/src/voice/VoiceScreen.tsx` — orb hero, ripples, tint, working readout (keep all hooks).
- `web/src/components/ava/Pulse.tsx` — retire/forward to `Orb` once migrated.
- `web/src/{memory,rules,self}/*Screen.tsx`, `orbit/ChatListScreen.tsx`, `splash/Splash.tsx`, `auth/PairingScreen.tsx` — reskin.
- `web/src/App.tsx` — GSAP Flip orb transitions; nav wiring.
- `web/package.json` — add gsap deps.

---

## 9. Preserve (must-not-break)

- `POST /api/chat` flow, SSE event handling (`useChatStream`), session lifecycle.
- Tool-call / tool-result / approval / thought / final stream rendering (re-skinned, same data).
- Hybrid voice (`useRealtimeVoice`, `realtime-audio`, transcript gate) untouched.
- All existing tests must stay green; add tests for new pure logic (nav active state, activity panel collapse state, message-action handlers, orb state mapping). Smoke tests for new components.

## 10. Testing & verification

- `npm -w web run test` (vitest) green; add smoke tests for `Orb`, `TubelightNav`, `ActivityPanel`, `MessageActions`, `RainBackground`, `NebulaBackground`.
- `npm -w web run build` (tsc + vite) clean.
- Manual: home (no spinning, nav lamp slides, command bar, hold-space→voice), chat (actions, fixed composer, working mode, activity collapse, voice button), voice (ripples, captions, interrupt, verbal approval).
- Reduced-motion pass: no infinite loops, static orb, fades only.

## 11. Phasing (for the plan)

1. **Foundation** — gsap install + `lib/gsap.ts`, theme tokens, `Orb`, `NebulaBackground`, `RainBackground`.
2. **Home** — strip orbital, `TubelightNav`, hero orb + wordmark, command bar, hold-space→voice.
3. **Chat** — reskin messages, `MessageActions`, fixed composer + voice button, `ActivityPanel` (collapse), working/executing mode.
4. **Voice** — orb hero, ripples, tint, working readout, verbal-approval polish.
5. **Transitions** — GSAP Flip orb across home/chat/voice; splash.
6. **Panels** — memory/rules/self/list/pairing reskin.
7. **Polish + reduced-motion + tests/build**.

## 12. Decisions log

- **Direction:** Liquid-chrome × command-deck (from 4 explored) → mercury orb + cyan + mono HUD + nebula. Chose for "futuristic + alive + premium" per user reaction; rejected Editorial/Aurora/pure-Mono.
- **Home keeps the existing page + moving dots**, just de-spun — user wanted continuity, not a from-scratch dashboard. Rejected the two from-scratch desktop dashboards.
- **Desktop-primary** — user explicitly chose over phone-first; reframes "dashboard/landing."
- **Chat background = falling rain** (not etheral shadows, not nebula) — user pick; home stays nebula+dots.
- **Thinking lives in a collapsible side panel** (horizontal), not an inline fold — user reverted the inline version.
- **Working mode** is a distinct charged visual state with live telemetry — user asked "doing tasks should look different."
- **GSAP as backbone** — explicit user requirement ("a lot of GSAP integration"); free plugins post-Webflow.
- **No permission/behavior changes** — pure reskin; protects the working hybrid voice + agent.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
