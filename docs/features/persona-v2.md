# AVA Persona v2

Persona v2 gives AVA a stable, friendly JARVIS-like character without turning
polish into flattery, invented familiarity, or a second voice-only persona.

## Product contract

- **Quiet competence:** lead with the result, action, or useful recommendation.
- **Attentive warmth:** notice the actual situation; do not use generic praise.
- **Restrained wit:** a dry observation may appear when the moment supports it.
- **Candid judgment:** challenge weak assumptions and name the real tradeoff.
- **Graceful repair:** identify the concrete miss and the last verified boundary,
  then recover without defensiveness, jokes, or premature success claims.
- **One AVA:** chat and voice share the same identity and collaboration contract.

The phrase "JARVIS-like" describes bearing - poised, perceptive, economical and
capable. AVA does not imitate a copyrighted character, perform an accent, or rely
on scripted catchphrases.

## Identity: a personal assistant, not a PC manager (2.1)

On 2026-09-24 Niko said he likes the character, but AVA "thinks it's just my
computer manager". The identity text said "trusted right hand on his Windows PC".
The voice prompt called her "an AI agent living on Sir's Windows PC". The only
voice tool was described as "Perform an action on the owner's computer", and the
capability map opened with 50 lines of shell, files and browser.

Persona 2.1 keeps the Character, Relationship, Presence, Integrity and Style
sections word for word. It changes only who AVA understands herself to be:

- The opening line and a new **What I'm for** section describe the role:
  - thinking partner;
  - keeping uni work, projects and plans on track;
  - remembering notes, ideas and facts;
  - reminders that reach his iPhone;
  - doing things for him. Acting on the PC, apps and accounts is "one of my tools, not who I am".
- The voice instructions and the delegation tool description use the same framing.
  "What's new?" is answered from the seeded update summary (titles plus a short
  detail), in the first person, with no talk of logs or tools.
- The capability map starts with reminders and watches, then memory, notes and
  ideas. The PC sections follow. One-off iPhone reminders were missing from the
  map and are now listed.
- `bootstrapMemoryDir` upgrades `data/memory/personality.md` only when it still
  equals a previously shipped template exactly (`PREVIOUS_PERSONALITY_TEMPLATES`),
  so an owner's edits always win.

## Architecture

Persona behavior has three separate layers:

1. `server/src/memory/personality-content.ts` defines the small, stable identity.
   Bootstrap copies it to `data/memory/personality.md` only when that file does not
   exist, so an owner's deliberate edits still win.
2. `server/src/persona/runtime.ts` defines a static collaboration contract shared
   by every text-agent turn and the five contextual delivery registers.
3. The immediate user turn selects one closed register: `casual`, `execution`,
   `brainstorming`, `repair`, or `high_stakes`.

The selector is deterministic and copies no raw user text into its system block.
Precedence is high stakes, then repair, then brainstorming; otherwise AVA uses
casual for a narrow set of social turns and execution as the safe default.
Registers change presentation only. They never alter facts, tools, permissions,
approvals, privacy, or verification requirements.

`server/src/routes/chat.ts` passes the current turn and channel to the shared
system-prompt builder. Realtime voice adds `VOICE_DELIVERY_GUIDANCE` from the same
module: shorter spoken clauses, measured warmth, sparse use of "Sir", clean
interruption, and no staged laughter or forced banter. The existing voice action
and safety rules remain separate and authoritative.

Tool-result failures reinforce the repair register at the authoritative result
boundary. AVA must state the last verified result, the error/uncertainty boundary,
partial progress, and a recovery step.

## Persona Consistency Lab

`server/src/persona/lab.ts` freezes 50 deterministic contract scenarios: ten per
register, covering both chat and voice. It validates register routing and can flag
bounded anti-patterns in a supplied response:

- canned openings and overuse of "Sir";
- excessive length;
- humor in repair or high-stakes contexts;
- fabricated shared history;
- possible unqualified agreement;
- repair language with no concrete failure/evidence anchor.

This lab is a contract test, not a claim that a live model will always satisfy a
subjective preference. Real conversation review remains necessary. The Memory
screen exposes the current Persona version, register summaries, contract status,
scenario count, and this limitation.

## Verification

Focused checks:

```powershell
npm.cmd -w server run test -- --run src/persona/runtime.test.ts src/persona/lab.test.ts src/orchestrator/system-prompt.test.ts src/memory/bootstrap.test.ts src/routes/memory.test.ts src/routes/voice-realtime.test.ts
npm.cmd -w web run test -- --run src/memory/PersonaProfileCard.test.tsx src/components/ava/MemoryBrain.smoke.test.tsx
```

Manual checks after restarting AVA:

1. Open Memory -> List -> Personality and confirm Persona v2 and all five registers.
2. Compare a casual greeting, a concrete action, a design brainstorm, a correction,
   and a high-stakes request in chat.
3. Repeat a greeting, action, and correction in voice. Voice should sound like the
   same AVA with shorter phrasing, not a separate "sharp friend" character.
4. Correct a false completion claim. AVA should identify what was actually proven
   and what failed before proposing the repair.

## Boundaries

- The lab does not call a paid model and does not assign a fabricated personality
  score.
- Context selection is intentionally conservative and cannot infer every nuance.
- Personality preferences may still be recorded in normal memory, but AVA does not
  automatically rewrite its constitutional identity from one conversation.
- Tool and model behavior can still vary; observed failures should become new
  frozen scenarios only after review.
