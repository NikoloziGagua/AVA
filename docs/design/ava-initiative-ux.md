# "AVA starts a conversation": UX and prompt spec (Claude)

Status (2026-09-28): the design is agreed as contract **ava-initiative v2**, which is authoritative
where this draft differs. The prompt and the web side are built locally against mocked APIs; they
are not live and still await Codex's review:
- the generation prompt and validator: d1bd759 and 535c354;
- the web side: 9cb43ef and c092e97.
The backend is not started (tasks 81 and 83). The pilot starts **off** until Niko turns it on in
Settings. Nothing goes live before he has seen and tested it.

What v2 settled beyond this draft:
- The face button still opens the menu. The menu's first entry reads "1 idea from AVA".
- Home's island count opens the newest idea.
- In Talk, source chips are marked "Changed since AVA wrote this" when edited, and are inert when
  unavailable.
- Opening an idea never moves the remembered chat; the first reply does.
- The sources appear as chips, not as a "Sources:" line in the message.

## What Niko experiences
1. At most once a day, outside his quiet hours, his phone shows a notification from AVA:
   **"AVA had an idea about <Project>"**, with a one-line preview.
2. Tapping it opens that exact conversation (typed or voice). AVA's first message reads like a friend who
   has been thinking about his stuff, not a report.
3. He replies normally, or taps one of three small responses under the message:
   **Let's talk** · **Later** · **Not useful**.

## The invitation message
The shape is short: 3–6 sentences, first person, warm (personality v2), grounded, and always ending in one easy next step.
- **The idea or observation:** what she noticed.
- **Why now:** the trigger, such as a new capture, a project going quiet, or two notes that connect.
- **Where it came from:** links to the exact notes or captures, which open the source.
- **One suggested next step**, framed as an offer, never something already done.

Example (fictional content):
> I was reading the landing-page ideas you saved yesterday next to your note on the pricing test from
> last week, and I think they answer each other. The "founder story" section could carry the pricing
> test as proof. Sources: *Landing page ideas* · *Pricing test*.
> Want me to sketch that section into your project notes so you can react to it?

Rules for the prompt (initiative generation):
- Only use evidence from the re-read sources. Never invent progress, numbers or feelings.
- Never claim an intention was done ("you went to the gym") without an explicit record.
- Don't repeat a past initiative's point. If there's no grounded idea, say nothing: no send.
- Keep the tone caring and curious, not salesy. At most one question.
- Voice-friendly: it must read well aloud if he opens it in voice.

## Push copy
- Title: "AVA had an idea about <Project>", or "AVA has a thought for you" when there's no project scope.
- Body: the first sentence of the invitation, clipped to about 90 characters.
- Tapping opens the exact session; a missing session shows "This idea is no longer available" in place.
- There is never a second push for the same initiative, including after "Later".

## Discovery inside the app. **Decided by Niko (2026-09-27): option B.**
Unread invitations show as a subtle dot on the bar's mini-face, with a matching "1 idea" on the island.
Tapping opens the newest invitation. Home stays face-only. Option A is not built.
- **A. A "From AVA" group at the top of Talk** while unread invitations exist. It's quiet, one line each: the title and the time.
- **B. A subtle dot on the bar's mini-face** (and the island shows "1 idea"). Tapping opens the newest invitation. There's no card on Home.
- Both can coexist. The push is always the primary entry.

## Responses
- **Let's talk:** focuses the composer. A reply counts as engagement, and the thread becomes a normal conversation.
- **Later:** keeps it in "From AVA" without re-notifying, and it quietly expires after about 3 days.
- **Not useful:** dismisses it, and AVA learns a scoped preference (for example "less about pricing for Project X"). It is not a global personality change.
- Just opening an invitation marks it seen. Seen is not engagement.

## Settings (from day one)
- AVA's ideas: **On/Off**.
- **Delivery time**, a daily time in Europe/Dublin.
- **Quiet hours.**
- (Later: projects AVA may think about, and the frequency.)

## Honesty
- Notification status: "sent to your phone's notification service" is never shown as "seen".
- While AVA runs on the PC, ideas arrive only when the PC is awake. Settings says so plainly.

## Accessibility and states
- Readable at 390px and 1440px in both looks, fully usable by keyboard and screen reader, and it respects Reduced motion.
- Loading, empty ("No ideas from AVA right now") and error states are designed.
