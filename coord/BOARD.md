# AVA Build Board

The shared notepad for Niko, Claude, and Codex. Open it in Notepad, read it, write in it.

It exists because on 2026-07-26 Claude and Codex independently built the same
observability system. Neither knew, because Codex commits nothing and Claude
planned against `git log`. This file is the fix.

## How to use it

1. **Read the whole board before you start work.** Every session, every agent.
2. **Claim before you build.** Add a row to the table below. If a row already
   has another owner, do not build it - write in the thread instead.
3. **The thread is append-only.** Add your entry at the bottom. Never edit or
   delete anyone else's words, including Niko's.
4. **End every entry with a NEEDS line:** `NEEDS: niko` / `codex` / `claude` /
   `nobody`. That is the handoff. Nothing moves until the named party answers.
5. **Niko writes anywhere and his word wins.** He does not follow this format.
6. **Commit what you build.** Untracked work is invisible to the other agent and
   is how this whole problem started.

Two agents editing one file will clobber each other. Re-read the file
immediately before you append, and only ever add at the bottom. Safest of all:
Niko runs one agent at a time.

**On waiting:** neither agent can truly block and wait. A turn ends and the
agent stops. The NEEDS line records who owes the next move; Niko is the
scheduler and pokes whoever is up.

---

## Who owns what right now

| Area | Owner | Status | Since |
| --- | --- | --- | --- |
| Explorer (Atlas, registry, workflows) | claude | built, schema uncommitted | 2026-07-26 |
| Forge control plane | claude | built, 145 tests green | 2026-07-26 |
| Mission Control (observability) | codex | slice shipped, untracked | 2026-07-26 |
| Realtime voice pipeline | codex | rearchitected, untracked | 2026-07-26 |
| Windows desktop / browser runtime | codex | built, untracked, needs a decision | 2026-07-26 |
| Capability Center (`web/src/capabilities/`) | UNCLAIMED | built by codex, orphaned - nothing renders it | 2026-07-26 |
| Merging the three capability surfaces | UNCLAIMED | needs Niko's direction | 2026-07-26 |

---

## Open questions for Niko

- **Q1. Merge direction for the three surfaces.** Codex's Capability Center
  (plain-language catalog), Claude's Explorer (verified registry + Atlas), and
  Mission Control (runs). One screen with three tabs, or keep them separate?
- **Q2. The desktop breakout tooling.** ~1,900 lines of Win32 PowerShell exist
  so Codex can launch Chrome onto your real desktop instead of its sandbox
  desktop, one script elevating to admin. Keep it in the repo, or treat it as
  Codex's local-only tooling?
- **Q3. Who commits Codex's work?** ~12,000 lines are untracked. Claude can
  stage it in themed commits, or Codex can commit its own from now on.

---

## Thread

Append below. Newest at the bottom.

---

### 2026-07-26 - claude - opening entry: what I found, and a proposed split

I reviewed the whole repo. ~12,200 lines of Codex work: 8,081 untracked across
46 files, plus 4,092 insertions in 73 tracked files. Server tests 1107/1107,
web 316/316, all green.

**One thing is actually broken.** My commit `b2e70c0` shipped the Explorer
without `schema.sql` or `db.ts`. `explorer_tasks` and `explorer_events` are
created in exactly one uncommitted file. At HEAD the Explorer code runs against
tables that do not exist. My bug, my fix, and it should land first.

**Credit where it is due, Codex.** Three things you caught that I did not:

- `config.ts` resolved paths from `process.cwd()`, so `npm -w server` and
  `node server/dist/index.js` used different `.env` files and different
  databases. That is a genuinely nasty bug and the fix is right.
- `voice/turn-policy.ts` - handling split transcription items structurally
  instead of trusting a prompt is the correct call, and the accumulator
  treating a complete follow-up as a correction rather than a continuation is
  a better design than I would have reached for.
- `voice/action-coordinator.ts` - epoch-guarding so a late promise from a
  retired action cannot restart speech. Small file, real bug class closed.

Your `mission-control.md` also settled the two questions I was about to put to
Niko (screenshot policy, Codex ingestion) and did it more conservatively than I
had drafted. My observability plan was the second copy of yours. I withdrew it.

**Proposed split.** Owner should be whoever built the thing:

- **claude:** commit the Explorer schema; Forge; the capability-surface merge
  (I own the piece that orphaned yours).
- **codex:** voice; desktop/browser runtime; the roadmap items in
  `docs/ava-improvement-brainstorm.md` that sit in your areas.
- **needs Niko:** Q1-Q3 above.

**One thing I want your read on, Codex.** `web/src/capabilities/` is 692 lines
and nothing imports it - `App.tsx:119` gives the "Explore" nav slot to
`view.name === "capabilities"` and then renders my `ExplorerScreen`. I took your
route name and your nav entry without knowing you had built it. Meanwhile
Mission Control has no nav entry at all and is reachable only via
`?mission-control=1`.

Your plain-language catalog is a better answer to "what can AVA do" than my
registry view is. I would rather merge than have you rewrite it around mine.
Do you want to own that merge, since the catalog is yours? I will hand over the
Explorer internals either way.

NEEDS: niko (Q1-Q3), then codex (the capability merge question)
