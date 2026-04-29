# Ava Frontend Remodel — Design Spec

**Date:** 2026-04-29
**Status:** approved (ready for implementation plan)
**Scope:** complete rebuild of `web/src/` UI in a new "orbital" aesthetic. Adds chat-delete and a cinematic voice mode. Server changes minimal (one endpoint, one schema column).

---

## 1. Goal

Replace the current functional-but-plain Ava PWA frontend with a distinctive, cinematic "orbital" interface built around a single gradient pulse that morphs across screens. Add the two most-requested features: ability to delete chats, and a full-featured voice mode that feels premium.

## 2. Aesthetic & visual language

**Vibe:** "Orbital" — pure-black backgrounds, animated gradient pulse (purple → blue → teal) as the recurring motif, faint animated SVG paths as ambient texture. Cinematic, app-like, distinctive. Confirmed against two alternatives ("Moonlit" and "Paths-only").

**Theme:** dark-only. No light-mode toggle. Defers a future ask to a deliberate retrofit (called out in §9).

**Typography:** stays as Tailwind defaults plus a single tracking-tight variant for headlines. No custom font files added.

**Color tokens** (CSS vars in `web/src/theme.css`, applied at `:root`):
- `--ava-bg: #000`
- `--ava-fg: rgba(255,255,255,0.85)`
- `--ava-fg-muted: rgba(255,255,255,0.5)`
- `--ava-border: rgba(255,255,255,0.08)`
- `--ava-purple: #a855f7`, `--ava-blue: #3b82f6`, `--ava-teal: #14b8a6`
- Gradient: `linear-gradient(135deg, var(--ava-purple), var(--ava-blue), var(--ava-teal))`
- Confidence pills: `--conf-high: #10b981`, `--conf-med: #eab308`, `--conf-low: rgba(255,255,255,0.5)`

**Motion tokens:**
- `--motion-fast: 200ms` (button taps, microinteractions)
- `--motion-screen: 300ms` (screen transitions)
- `--motion-cinematic: 600ms` (orbit ↔ voice morph, splash)
- `--ease-cinematic: cubic-bezier(0.22, 1, 0.36, 1)`

## 3. Architecture

**Single-page React app, no router.** App state machine in `App.tsx` swaps screens via `<AnimatePresence mode="wait">`.

```ts
type View =
  | { name: "splash" }
  | { name: "orbit" }
  | { name: "chat"; sessionId: string | null }
  | { name: "voice"; from: "orbit" | "chat"; sessionId: string | null }
  | { name: "memory" }
  | { name: "rules" }
  | { name: "pairing" };
```

**Tech additions to `web/`:**
- `motion` (the `motion/react` import) — animation library; replaces hand-rolled CSS keyframes.
- `lucide-react` — icons.
- `class-variance-authority`, `tailwind-merge`, `clsx` — needed for shadcn.
- shadcn/ui primitives copied locally to `web/src/components/ui/`: `button`, `card`, `textarea`, `badge`, `dialog`. (Not the registry — we vendor them.)

**Server additions:** one new endpoint, one schema column, one cleanup sweep.
- `DELETE /api/sessions/:id` — soft-deletes (sets `deleted_at = now`).
- `sessions.deleted_at INTEGER NULL` — added to schema.
- App-start sweep hard-deletes rows with `deleted_at < now - 24h`.
- `listSessions` filters `WHERE deleted_at IS NULL`.

## 4. File structure

```
web/src/
├── App.tsx                          # state machine; <AnimatePresence> screen swap
├── theme.css                        # CSS vars (replaces styles.css)
├── lib/utils.ts                     # cn() helper
├── components/ui/                   # shadcn primitives (button, card, textarea, badge, dialog)
├── components/ava/
│   ├── Pulse.tsx                    # gradient orb; props: state, size, amplitude, layoutId
│   ├── ShiningText.tsx              # shimmer text for "thinking"
│   ├── PathsBackground.tsx          # animated SVG path layer
│   └── OrbitRing.tsx                # circular ring with positioned children
├── orbit/
│   ├── OrbitScreen.tsx
│   ├── OrbitNode.tsx                # one node; long-press → delete affordance
│   └── useOrbitRotation.ts          # auto-rotate outer ring + pause-on-interact
├── chat/
│   ├── ChatScreen.tsx
│   ├── MessageList.tsx
│   ├── Composer.tsx
│   ├── ToolCallChip.tsx             # collapsed inline "▸ memory_read"
│   └── useChatStream.ts             # KEEP existing
├── voice/
│   ├── VoiceScreen.tsx
│   ├── useMicAmplitude.ts           # Web Audio API → amplitude (0..1)
│   └── useVoiceSession.ts           # wraps existing /api/voice realtime
├── memory/MemoryScreen.tsx          # restyled (sections: Personality / Preferences / Observations / Projects)
├── rules/RulesScreen.tsx            # consolidated (Reasoning + Pinned chips + Devices + Provider)
├── auth/PairingScreen.tsx           # restyled
├── api.ts                           # KEEP, add deleteSession()
├── auth/tokens.ts                   # KEEP
├── push/register.ts                 # KEEP
├── sw.ts                            # KEEP
└── main.tsx                         # KEEP
```

**Removed/replaced:** `App.tsx` (rewritten), `styles.css` (→ `theme.css`), `chat/ChatScreen.tsx`, `chat/MessageList.tsx`, `chat/Composer.tsx`, `chat/QuickChips.tsx` (folded into Composer), `rules/RulesScreen.tsx`, `memory/MemoryEditor.tsx` (→ `MemoryScreen.tsx`), `sessions/SessionsScreen.tsx` (functionality absorbed into `OrbitScreen`), `auth/PairingScreen.tsx`.

**Kept verbatim:** `chat/useChatStream.ts`, `auth/tokens.ts`, `push/register.ts`, `sw.ts`, `main.tsx`, `approvals/ApprovalCard.tsx` (no UI change requested), `auth/tokens.test.ts`.

**Kept but modified:** `api.ts` (add `deleteSession()`), `memory/MemoryEditor.smoke.test.tsx` (renamed to `MemoryScreen.smoke.test.tsx` and rewritten against the new component).

## 5. Screens

### 5.1 Splash (cold-boot only)

Shown for ~1.5s on first paint of every app launch. `<PathsBackground />` at full opacity, "Ava" wordmark letter-by-letter type-on (letterIndex × 30ms stagger, spring 150 stiffness). At 1.2s: paths fade to 0.15 opacity, wordmark scales 1→0.4 and translates to where the orbit center pulse sits, then we transition to `orbit`. Total 600ms zoom-out from splash → orbit.

### 5.2 Orbit (home)

Pure-black background. Two concentric rings centered, ambient `<PathsBackground />` at 0.1 opacity behind everything.

**Center pulse** (size 64px) — gradient orb in `idle` state. Long-press (≥300ms) → enters voice mode. Below it: `HOLD TO SPEAK` label, 9px uppercase, 0.6 opacity.

**Inner ring** (radius 90px, static, dashed border at 0.12 opacity):
- `+` node at 9 o'clock position → new chat
- `⊕` node at 1 o'clock position → memory
- `⚙` node at 5 o'clock position → rules

Tools labels are always shown beneath each node (9px, 0.6 opacity).

**Outer ring** (radius 170px, auto-rotates at 0.3°/frame, ~6s/revolution; solid border 0.08 opacity):
- Up to 8 chat nodes (most recent first by `last_active_at`). Older sessions remain in the database but are not surfaced on orbit (no overflow UI in this iteration — flagged in §11 as deferred).
- Each node: 24px circle with 1.5px white-50% border. Label shows below at 8px, 0.55 opacity, max-width 90px ellipsis.
- Drag-rotate (touch) or scroll-wheel-while-hovering-the-ring spins the visible 8 around the orbit so any can be brought front-and-center; it does NOT load older sessions beyond the cap.
- Auto-rotation pauses when any node is hovered/focused/pressed; resumes 1s after release.

**Long-press a chat node:**
1. Press timer starts at 0ms; node ring color animates white→red over 500ms.
2. At 500ms: enter `deleting` state — red ring solidifies, 14px ✕ chip appears tangent to the node.
3. Tap ✕ → optimistic remove, fire `DELETE /api/sessions/:id`, show "Deleted · undo" toast 5s.
4. Tap-elsewhere or Esc cancels.
5. Tools nodes (+ ⊕ ⚙) ignore long-press entirely.

**Tap a chat node:** screen transitions to `chat` with that `sessionId`.

### 5.3 Chat (Hybrid layout)

Header: 56px tall, `← back-to-orbit` (left), session title (center, auto-titled), 14px gradient pulse (right) reflecting Ava's current state.

Body: scrollable message list with 16px padding. User messages right-aligned in glassy bubbles (`rgba(255,255,255,0.1)`, 1px white-8% border, 14px radius with 2px bottom-right corner, 75% max-width). Ava messages left-aligned plain text (no bubble, 0.85 opacity, 85% max-width, 1.55 line-height).

Behind everything: `<PathsBackground />` at 0.18 opacity.

**Tool calls** appear inline as collapsed `<ToolCallChip />` rows: 1px white-8% border, 8px radius, monospace 10px, white-60% color, format `▸ tool_name · arg_summary`. Tap to expand into full tool input/output.

**Thinking state:** between user message and final response, show `<Pulse state="thinking" size={14} />` inline followed by ShiningText caption ("checking memory…", "running shell…", etc.).

**Composer** (sticky bottom, gradient mask above):
- 12px padding row of QuickChips above the input (horizontal scroll, no labels visible).
- Input row: glassy textarea (`rgba(0,0,0,0.7)` + backdrop-blur 12px + 1px white-12% border, 14px radius), 24px gradient pulse (mic → voice mode entry), 28px white square send button with ↑.
- Tap mic → `voice` state with `from: "chat"`, `layoutId="ava-pulse"` morphs the inline pulse into the fullscreen orb.

### 5.4 Voice mode (full-screen)

Background: radial gradient `circle at 50% 50%, [tint] 0%, #000 70%` where tint depends on state (purple-tinted while listening, blue-tinted while responding, neutral while thinking).

Top header (18px from edges):
- Left: `LISTENING · 0:04` style status label (9px uppercase, 0.5 opacity, live timer).
- Right: 32px ✕ button → exit (cinematic shrink back to orbit center, or back to chat composer if `from: "chat"`).

Center: `<Pulse />` at size 120px with `layoutId="ava-pulse"`. Three concentric expanding rings around it (160 / 220 / 280px diameters, opacities 0.4 / 0.25 / 0.15). State drives appearance per §6.

Below pulse (170px from bottom): live caption block.
- Label: 9px uppercase, 0.4 opacity (`YOU` while you speak, `AVA` while she speaks).
- Caption: 14px white, 0.9 opacity, 1.4 line-height, center-aligned, max-width 280px.
- Updates live as the realtime API streams transcript tokens.

Bottom controls (30px from bottom, centered, 18px gap):
- Left 48px: mute toggle (🔇 / 🎙)
- Center 60px: end-call. Red ⏹ when listening; white 🎙 when Ava is speaking (= "interrupt").
- Right 48px: ⌨ keyboard fallback → exits voice but keeps session, opens `chat` with composer focused.

**Auto-save:** voice messages append to the same `messages` table as typed chats. On voice-mode entry from orbit (`sessionId === null`), we mint a session immediately so the orbit shows the new node when you exit.

### 5.5 Memory

Header: `← Memory` (back to orbit), no other controls.

Body, vertically stacked sections separated by `border-bottom: 1px solid white-5%`:

1. **Personality** (collapsible, default collapsed). Shows the personality.md content as read-only formatted text when expanded.
2. **Preferences** (always expanded). List of preference lines from preferences.md. Each row: 1px white-8% border, 8px radius, 11px text, 0.85 opacity, 10px padding. Header has `+` button to add. Click row to edit (textarea inline). Long-press to delete.
3. **Observations** (always expanded). Header shows count. Below: horizontal scrollable category-pill bar (`all` / `context` / `people` / `setup` / `skills` / `schedule` / `preferences`). Active pill: 1px white-50% border, white-10% bg, white text. Inactive: 1px white-12%, white-60%. Below pills: filtered observation rows. Each row: confidence pill (high/med/low color), then text, then date (right-aligned, white-35%). Click to edit, long-press to delete.
4. **Projects** (collapsible, default collapsed). Read-only list of subdirectories under `data/memory/projects/`.

### 5.6 Rules

Header: `← Rules` (back to orbit).

Vertically stacked sections:

1. **Reasoning** — two pill-buttons (`Fast` / `Thorough`), full-width row. Active state: 1px white-50% border + white-8% bg. Sub-label below each: "minimal · low" / "low · medium". Hits existing `PUT /api/reasoning`.
2. **Pinned chips** — list of pinned QuickChip prompts. Each row 1px white-8% border + 8px radius. Header `+` adds. Row `⋯` menu = edit / unpin / delete. Hits existing `/api/chips/pinned`.
3. **Devices** — list of paired devices from `GET /api/auth/devices`. Each row shows label + paired-on date + red `revoke` action.
4. **Provider** — read-only display of current LLM provider (e.g., "OpenAI · gpt-5") with green status dot if reachable.

### 5.7 Pairing

Background: `<PathsBackground />` at full opacity (matches splash). Wordmark "Ava" centered top.

Body: glassy code input (mirror voice mode's component vocabulary) — 6 single-character inputs in a row, auto-advance. Below: `Submit` button, white bg + black text, full-width-minus-padding, 14px radius. On success → orbit (no splash).

Error state: input row shakes (motion 250ms) + red 1px border + small caption "invalid or expired code".

## 6. The `<Pulse />` component (shared across screens)

Single component, four states. Uses `motion.div` with `layoutId="ava-pulse"` so transitions between screens morph the same physical element.

Props:
```ts
type PulseState = "idle" | "listening" | "thinking" | "responding";
type PulseProps = {
  state: PulseState;
  size: number;        // px
  amplitude?: number;  // 0..1, only used when state === "listening"
  layoutId?: string;
};
```

State visuals:

| State | Base | Animation |
|---|---|---|
| `idle` | gradient circle, soft purple glow | scale 0.96 ↔ 1.04 over 4s, ease-in-out, infinite |
| `listening` | gradient circle, larger glow | scale = 0.85 + amplitude × 0.3 (no time-loop, mic-driven). Three expanding rings rendered as siblings (CSS keyframe scale 1→1.6 + opacity 0.4→0, 1.5s stagger 0.5s each) |
| `responding` | morphing blob (animated `border-radius`), shifted color (more blue/teal weight) | border-radius keyframes `[46/54, 54/46, 50/50]%/[52/48, ...]%` over 1.4s infinite |
| `thinking` | desaturated base + linear-gradient overlay matching `<ShiningText />` (`#404040 35%, #fff 50%, #404040 65%`) | background-position 200% → -200% over 2s linear infinite |

`<Pulse layoutId="ava-pulse" />` is rendered at: orbit center, chat composer (mic button), voice mode center. Only one is mounted at a time per screen — `motion`'s shared-layout system handles the morph between renders.

## 7. Animations

**Screen transitions** (handled in `App.tsx` via `<AnimatePresence mode="wait">`):
- `splash → orbit`: paths fade 1→0.15, wordmark scales 1→0.4 + translates to orbit center, then `orbit` fades in (600ms ease-cinematic).
- `orbit → chat`: orbit `scale 1→1.4 + opacity 1→0` (300ms), chat `opacity 0→1, y 20→0` (300ms). Stagger 0.
- `orbit → voice`: shared `layoutId="ava-pulse"` morphs the center pulse to fullscreen size; rings + nodes + labels `opacity 1→0` (200ms).
- `chat → voice`: shared `layoutId` morphs composer mic to fullscreen orb; chat body `opacity 1→0` (200ms).
- `voice → orbit|chat`: reverse of entry. ✕ press triggers exit.
- `*  → memory|rules`: slide-up modal (`y: 100% → 0`, 300ms ease-out). Backdrop fade 0→0.6.

**Long-press feedback:** node ring stroke color animates `rgba(255,255,255,0.5) → rgba(239,68,68,1)` over 500ms (the press duration). Hits red exactly at trigger threshold. Release before threshold reverts smoothly.

**Delete animation:** ✕ tap → node `scale 1→0 + rotate 0→360deg + filter brightness 1→2` (200ms ease-in), then removed. Sibling chat nodes ease into the gap (auto via `motion`'s layout animation on the parent ring container).

**Auto-rotation:** outer ring uses `useOrbitRotation` — increments rotation angle by 0.3° on a 50fps interval. Pauses when `nodeBeingPressed || nodeHovered || nodeExpanded`. Resumes 1s after the interaction ends.

**Reduce-motion:** `prefers-reduced-motion: reduce` applies globally — collapses all transitions to opacity fades only (no scale, rotate, blur, translate). Auto-rotation disabled. `<Pulse />` still renders but state animations replaced with single static frame per state. Voice mode pulse becomes static circle with state-based color, no morphing.

## 8. Server changes

### 8.1 Schema

Add to `server/src/state/schema.sql`:
```sql
ALTER TABLE sessions ADD COLUMN deleted_at INTEGER NULL;
CREATE INDEX idx_sessions_deleted ON sessions(deleted_at);
```

Migration handled in `state/db.ts` startup (idempotent: try-add column, ignore "duplicate column" error).

### 8.2 Routes

`server/src/routes/sessions.ts`:
```
DELETE /api/sessions/:id  →  204 No Content
```

Implementation:
- `softDeleteSession(db, id)` sets `deleted_at = Date.now()`.
- `listSessions(db)` adds `WHERE deleted_at IS NULL`.
- `getSession(db, id)` already returns null for non-existent; deleted rows return null too.

### 8.3 Cleanup sweep

`server/src/state/sessions.ts`:
- New `purgeDeletedSessions(db, olderThanMs)` — `DELETE FROM sessions WHERE deleted_at < ?` with cascade to messages/tool_calls (FK already cascades).
- Called once at server startup with `Date.now() - 24*60*60*1000`.

### 8.4 Voice transcript persistence

`server/src/routes/voice.ts` — extend the realtime SSE proxy to:
- Accept `sessionId` query param.
- On each `transcript.user` event: append `{role:"user", content:text}` to messages.
- On each `transcript.assistant` event: append `{role:"assistant", content:text}` to messages.
- If `sessionId` is null on first event, mint one (matches `POST /api/chat` behavior).

This is the integration risk flagged in §9. A spike in Phase 4 verifies the OpenAI Realtime event stream actually emits these as discrete final-transcript events vs. only deltas.

## 9. Build sequence

1. **Phase 0 — Foundations** (~half day). Install deps, scaffold `theme.css`, `lib/utils.ts`, `components/ui/*`. App keeps working with old code.
2. **Phase 1 — Shared primitives** (~1 day). `<Pulse />` (4 states + layoutId), `<ShiningText />`, `<PathsBackground />`, `<OrbitRing />` + smoke tests.
3. **Phase 2 — Orbit home** (~1 day). `OrbitScreen`, `OrbitNode`, `useOrbitRotation`, long-press hook. New `DELETE /api/sessions/:id` + `deleted_at` schema. Replace landing in App.tsx.
4. **Phase 3 — Chat screen** (~1 day). New `ChatScreen`, `MessageList`, `Composer`, `ToolCallChip`. Keep `useChatStream` untouched.
5. **Phase 4 — Voice mode** (~1.5 days). Spike first: transcript persistence end-to-end. Then `VoiceScreen`, `useMicAmplitude`, `useVoiceSession`, 3 states, controls, layoutId morph.
6. **Phase 5 — Memory + Rules + Pairing** (~1 day). `MemoryScreen`, `RulesScreen` (consolidated), `PairingScreen` reskin.
7. **Phase 6 — Polish & splash** (~half day). Cold-boot splash, `prefers-reduced-motion` audit, real-device gesture tuning, smoke test pass.

**Total: ~6 days.** Each phase is independently shippable — app stays working between phases.

## 10. Risks

1. **Voice transcript persistence (Phase 4 spike).** OpenAI Realtime emits transcript deltas; we need final-transcript events to append to messages. If only deltas are emitted, we buffer per-turn server-side. **Mitigation:** spike verifies both turns persist before screen work begins.
2. **iOS PWA long-press collisions.** Safari's text selection / force-touch interferes. **Mitigation:** explicit `touch-action: manipulation` + `user-select: none` on nodes, pointer events not touch events, tested on real device early in Phase 2.
3. **`layoutId` morph from inline composer mic to fullscreen orb.** `motion` is finicky when source is in a flex parent and target is fixed-positioned. **Mitigation:** if it fights, fall back to fade transition with no shared layout (visually 90% as good — the gradient is the same).
4. **Auto-rotation accessibility.** Already mitigated via `prefers-reduced-motion` + pause-on-hover.
5. **No light theme.** Locking dark-only now means a future light-mode ask is a real retrofit (every component would need theme-aware tokens). Flagged so it's an explicit decision now, not a regret later.
6. **Voice session naming.** Voice transcripts auto-title via the same `autoTitle()` flow as typed chats, but the first user "message" might be a long voice utterance. Existing `autoTitle` slices to 60 chars on the first message — should still produce acceptable titles but worth verifying in Phase 4 spike.

## 11. Out of scope

- Light mode / theme switcher.
- Customizable orbit (drag to reposition tools, custom colors, etc.).
- Multi-user / shared sessions.
- Approvals UI redesign — `ApprovalCard.tsx` stays as-is for now.
- Web push notification UX changes — current "enable notifications" flow stays.
- Export / share chat threads.
- Search across chats — current sessions screen had no search; orbit doesn't either. Could be added later via long-press on `+` node.
- Overflow access to chats older than the most-recent 8 (no "see all" view, no pagination). Older sessions are still preserved in the DB and reachable via direct URL/sessionId, just not surfaced on orbit.

## 12. Acceptance criteria

- Every screen in §5 renders correctly on a real iPhone PWA at 390×844.
- `<Pulse />` morphs between orbit center, composer mic, and voice fullscreen with no flicker (or graceful fallback if layoutId fight loses).
- Long-press → delete flow works on iOS Safari without triggering text selection.
- Voice mode round-trip (orbit → voice → 1 turn → exit) persists both user and Ava transcripts to the messages table; the new session shows up as a node on orbit return.
- `prefers-reduced-motion: reduce` disables all non-opacity transitions and auto-rotation.
- No light-theme styles anywhere — all colors come through `theme.css` tokens.
- Existing tests still pass; new smoke tests cover `<Pulse />` state variants and `OrbitNode` long-press detection.
