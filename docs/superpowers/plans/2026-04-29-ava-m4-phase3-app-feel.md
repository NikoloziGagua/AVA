# M4 Phase 4 — App-feel layer (Greeting, Project Auto-load, Quick Chips)

**Goal:** Ship the "app-feel" experience defined in M4 design §5: morning greeting, mid-run project context auto-load, and quick-prompt chips.

**Architecture:** Add device-keyed `device_state` and `chip_overrides` tables. Synthetic system instruction prepended to first-of-day session transcripts. Path-detection helper reads `MEMORY.md` index. QuickChips frontend reads/writes a chip API; auto-generation worker fires on session create.

**Tech Stack:** Express 5, better-sqlite3, vitest, React 19, TypeScript strict.

---

## Task A: device_state table + first-of-day greeting

**Files:**
- Modify: `server/src/state/schema.sql` (add `device_state`)
- Create: `server/src/state/device-state.ts`
- Create: `server/src/state/device-state.test.ts`
- Create: `server/src/orchestrator/greeting.ts`
- Create: `server/src/orchestrator/greeting.test.ts`
- Modify: `server/src/routes/chat.ts` (use greeting prefix)

**Spec:** §5.1 — synthetic system message with last-session timestamp + summary.

Greeting helper returns `{ greet: boolean, prefix: string }` where prefix is the synthetic system instruction. `shouldGreet(db, deviceId, today)` returns true once per (device, calendar date) and updates `last_greeting_date`. The synthetic instruction is **prepended** to `transcriptForAgent` only on the first turn of the first session of the day.

## Task B: Project auto-load — path detection from MEMORY.md

**Files:**
- Create: `server/src/memory/project-index.ts`
- Create: `server/src/memory/project-index.test.ts`
- Modify: `server/src/orchestrator/system-prompt.ts` (already accepts `projectContext`; add resolver)
- Modify: `server/src/routes/chat.ts` (resolve project from prompt → pass to buildSystemPrompt)

**Spec:** §5.3 — read `MEMORY.md` for project entries pointing into `projects/<slug>.md`, regex extract their absolute paths, pick the longest match in the user message. Read `projects/<slug>.md` and pass as `projectContext`.

## Task C: Project auto-load — mid-run tool-call detection

**Files:**
- Modify: `server/src/orchestrator/agent.ts` (after each tool call, look at args for path → if matches, append project context as extra system-role message in messages array)

**Spec:** §5.3 — when a project is loaded mid-run it's appended as an extra system-role message, not a prefix mutation. Multi-turn conversations carry the loaded project.

## Task D: chip_overrides table + chips routes

**Files:**
- Modify: `server/src/state/schema.sql` (add `chip_overrides`)
- Create: `server/src/state/chip-overrides.ts`
- Create: `server/src/state/chip-overrides.test.ts`
- Create: `server/src/routes/chips.ts` (GET/POST/PATCH/DELETE)
- Create: `server/src/routes/chips.test.ts`
- Modify: `server/src/index.ts` (mount route)

## Task E: chip auto-generate worker

**Files:**
- Create: `server/src/orchestrator/chip-generator.ts`
- Create: `server/src/orchestrator/chip-generator.test.ts`
- Modify: `server/src/routes/chat.ts` (fire-and-forget on session create)

**Spec:** §5.2 — extract top recurring prompts from last 7 days, plus "Resume yesterday" when a prior-day session exists, plus "Open <project-slug>" for the most-recent project. `gpt-5-mini` summarizer reduces them to 2-4 word chip labels.

## Task F: QuickChips frontend

**Files:**
- Create: `web/src/chat/QuickChips.tsx`
- Modify: `web/src/chat/ChatScreen.tsx` (mount above composer)
- Modify: `web/src/state/api.ts` (chips fetch helpers)

## Task G: Smoke notes + commit

Update `docs/superpowers/specs/2026-04-28-ava-m4-design.md` smoke section if needed; ensure full test suite green.
