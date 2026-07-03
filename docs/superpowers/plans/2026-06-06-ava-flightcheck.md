# Ava Flightcheck — a canary regression gate for self-improvements (Increment 1)

**Origin:** A genuine Ava↔Claude discussion (2026-06-06). Ava proposed it unprompted
when asked for the ONE major self-improvement that most helps Sir's usability,
her effectiveness, and his satisfaction. Her framing: *"Trust is the product. If I
ship a clever capability and silently break voice again, that's not progress —
that's me putting a bow on a rake."* Claude pressure-tested scope/safety/credits;
both converged on the slice below.

## The problem it kills
"A self-improvement broke the thing Sir uses, and nobody knew until he touched it."
The existing verify gate runs unit tests + build + boot-smoke, but the regressions
that actually burned Sir (push-to-talk broke hands-free) lived in the **stateful
voice wiring** (reducers/effects/mic-gating refs) — thinly tested, only visible at
runtime. Flightcheck closes that gap deterministically, before any hot-swap.

## Increment 1 — deterministic, REPORT-ONLY, no browser/mic
Bounded so it fits low Anthropic credits and cannot itself break anything.

### (a) Backfill stateful voice-wiring tests (where the wound was)
Pure-reducer tests (no DOM), running inside the existing verify gate:
- hybrid-effect mapper (`realtimeActionToHybridEffect`)
- mode-change reconnect decision (`shouldReconnectForModeChange`)
- speak-worker reopen/abort decisions (`reopenAfterSpeak` + epoch abort semantics)
- mic-gate transitions / barge-in interrupt path

### (b) Headless `ava-flightcheck` runner (deterministic, cheap, repeatable)
After build, assert what's checkable WITHOUT a mic/browser:
- build succeeded + dist freshness/version marker present
- service worker contains `skipWaiting` / activation intent
- server boots on an isolated port
- `/api/chat` round-trips a tiny deterministic prompt
- `/api/voice/realtime` accepts the WS upgrade and handles a malformed init cleanly
- emits a structured artifact (JSON + logs) at a predictable path with the EXACT
  failing assertion — never "verification failed" mush

### (c) Wire into verify — REPORT-ONLY
- runs after the existing tests/build/boot-smoke
- journal states `flightcheck: passed report-only` or `failed report-only` (Sir
  never wonders whether it ran)
- does **NOT** block the hot-swap yet; a failure is loud + inspectable, not fatal

## Strict non-goals (increment 1)
No approval/security/sandboxing changes. No hot-swap behavior change. No realtime
audio simulation. No service-worker refactor beyond a minimal build/version marker
if one is missing. No browser/mic/screenshot (that's increment 2).

## Definition of done
- Existing verify behaves EXACTLY as before re: pass/fail.
- New deterministic voice-wiring tests exist and catch the hands-free/PTT class.
- `ava-flightcheck` runs manually AND from verify, emitting structured artifacts.
- Verify includes it report-only after build.
- Current fixed build passes (or any failure is clearly "coverage needs tuning,"
  not app breakage).

## Increment 2 (deferred, only once 1 is trusted)
Canary-browser PWA load + screenshots + flip flightcheck to ENFORCED (blocks swap).

## The one sensitive point (for Sir to decide)
Part (c) touches Ava's OWN verify pipeline — which her autonomous self-dev is
normally forbidden from modifying (see `server/src/self/suggest.ts`). Report-only
contains the risk (it can't block or alter swaps), and the FIRST flightcheck build
can't verify itself, so it must be hand-verified once (Claude + Sir) before trust.
Decision: how much does Ava run autonomously vs Claude hand-building the sensitive
wiring. (a)+(b) are additive/safe for Ava; (c) modifies the self-improve loop.
