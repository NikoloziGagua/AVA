# AVA in metal: where each component lives (proposal for Niko)

Drafted by Claude with Codex, 2026-09-26. This is a proposal to react to, not a
decision and not code. Codex turns it into one interactive preview page, with a
real side-by-side where a choice is Niko's taste.

## The idea in one line

AVA is a presence first and a tool second. Home and Voice are her face in a field
of stars and almost nothing else. Every other screen is a calm, readable
workspace. Motion appears where something real happens: you touch something, AVA
starts or finishes work, time moves on. It never plays just to fill a screen.

## Rules that keep it beautiful

- **The first screen fits.** Home and Voice never scroll on a phone, a laptop or
  a wide screen. The face scales to the room it has.
- **We suggest two live graphics at most** (your call, see choice 1 below). AVA's face is one. The real liquid-metal button
  (the one Niko loves) is the other, used as the single hero control on a screen.
  Other metal buttons use a close imitation. We show both side by side so Niko
  can judge whether the imitation is good enough.
- **Motion means something.** Beams and flows only show real steps AVA took,
  never pretend work. Reduced motion shows a still, complete version of every
  screen.
- **Readable first.** Body text is 15px and nothing is smaller than 12px.
  Hierarchy comes from space and weight, not tiny grey labels.
- **One way around.** A single bar at the bottom: type, talk, or open the menu.
  The preview's top "Home / Voice / Components / All AVA" controls are only for
  browsing the preview.

## Screen by screen

| Screen | What you see | Components | Why |
|---|---|---|---|
| **Home** | Stars, AVA's large breathing face, "Good evening, Niko.", one liquid-metal **Talk to AVA**, and the slim message bar | WarpStarfield (slow drift), the face, ElasticText on the greeting, **LiquidMetalButton** (real), DynamicIsland | Nothing competes with her. The greeting gives a little when your pointer passes. |
| Home, one tap | The status island grows into today's one thing (next class, due reminder or pinned note) | DynamicIsland → ProgressiveCardReveal | Home stays empty, but what matters today is one tap away, from the same truthful ranking as now. |
| **Voice** | Stars keep drifting towards you behind the face, which fills the screen. The island says listening, thinking or speaking, and live captions sit under the face | WarpStarfield (gentle forward drift), the face, DynamicIsland, **LiquidMetalButton** (real, as hold-to-talk) | The living background stays; entering Voice can also play a brief warp, so you feel yourself going in. |
| **Today** | A split-flap clock and date, then your day as a timeline you scroll through; tap an item to open its details | SplitFlapDisplay, ScrollTimeline, ProgressiveCardReveal | Time is the subject of this screen, so time gets the character. |
| **Talk** | A calm conversation: AVA's answers read like a page, your words sit in soft bubbles. "What AVA did" opens her real steps as a flow | AgentFlow (her real tool steps only), Stepper for long tasks | You see her work as it truly happened, not an invented animation. |
| **Conversations** | Grouped by day, pinned first, with search | CardSwap for pinned only (optional), otherwise rows | Fast to scan. Motion only on the few you pinned. |
| **Notes** | Folder path at the top, files, then the page you're reading | Breadcrumbs, TiltCard for pinned files | Readable first. The tilt is a small reward, not in the way. |
| **Ideas** | A board or list, plus an optional browse mode | CoverFlow or CardSwap (browse mode), JellyButton for "new idea" | Ideas are for playing with; browsing them can be playful. |
| **Calendar** | Month and week, with quiet grid lines | ScrollTimeline in day view | Lines help reading a calendar. Everything else stays line-free. |
| **Memory** | What AVA remembers, people and projects | BeamDraw for how remembered things connect, drawn only from real links | Memory is about connections, so show the real ones. |
| **Explore AVA** | What AVA can do | BentoGrid; BeamDraw inside a capability's detail | Capabilities at a glance, bigger tiles for the important ones. |
| **Visual explanations** | AVA's explainer visuals | ImageAccordion (only where real images exist) | Browsing pictures is what the accordion is for. |
| **Self development** | AVA's improvement journal | ScrollTimeline | Her growth reads as a story you scroll through. |
| **Activity** | Runs, messages and evidence | AnimatedBeam dotted pipeline, driven by real run events | Watching a real task move through its stages is genuinely useful. |
| **Reminders & watches** | Upcoming stack and watches | ProgressiveCardReveal for receipt details | The honest delivery status stays readable. |
| **Settings** | Grouped settings on metal surfaces | JellyButton toggles (optional) | Quiet. |
| **Pairing / first run** | A calm welcome and a few steps | Stepper, GradientWave backdrop | The one place a colourful wave fits: the first hello. |
| Phone quick capture | A small plus that expands into note, idea, reminder | GooeyFab on Notes and Ideas only | Capture fast without leaving the page. It never covers the bar. |

Earlier motion-lab ideas (Signal, Choreography, Atlas, Time, Material) stay
available if you want any of them back. Codex's full list of every reference,
with what each one does, is in `docs/design/ui-reference-inventory.md`.

## Choices only Niko can make (shown side by side in the preview)

1. **Liquid metal**: the real shader on the one hero button per screen and an
   imitation elsewhere, or the real one on more buttons (heavier on a phone).
2. **Lines**: none except the calendar grid, or quiet lines in lists and columns too.
3. **White version**: keep a light "Paper" metal option, or dark only.
4. **Clock**: the split-flap clock on Today only, or also a small one on Home.
5. **Browsing Ideas**: cover-flow, card-swap, or just the board.

## What stays true underneath

Nothing about how AVA works changes: the same conversations, notes, reminders
and honest statuses. Approvals stay on the page and can't be swiped away. Their
existing risk-aware countdowns are unchanged, so a low-risk request may still
approve itself, and a high-risk one decline itself, if you don't answer in time.
This is how she looks and moves, not what she does.
