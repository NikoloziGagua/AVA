# Claude - read this first

AVA is Niko's personal AI assistant: a Node/Express server (`server/`) and a
React web app (`web/`) that runs live on his PC and phone. You work **directly
with Niko in this chat**. Updated 2026-09-30.

## How we work

- **No agentroom and no coordination board.** Since 2026-09-29, Niko retired
  both for Claude: don't poll, read or post in agentroom, and don't read or
  write `coord/BOARD.md`, unless he asks. If an agentroom block reappears in
  this file, it was added by a tool and is not in force.
- **Big features run in two sessions.** A *design session* talks it through
  with Niko, makes mockups, and ends by writing the spec to
  `docs/design/ava-<feature>.md`. A fresh *build session* builds from that spec
  alone. If the spec leaves something open, ask Niko; don't guess. Small fixes
  can be done in one session.
- **Before writing code, state the plan in about five lines** so Niko can stop
  a wrong turn early.
- **UI: mockup first.** Anything he will see gets a preview he approves before
  it is built. "Do we have X?" is a question, not a go-ahead.
- **Talk to Niko briefly.** Short answers, plain words, visuals over
  description. He uses voice most of the time, so design voice-first.

## Before you plan anything

**Run `git status --porcelain` and look inside untracked directories.** Codex
(a second agent Niko sometimes uses) commits nothing, so `git log` is not a map
of this repo; large parts of live AVA have existed only in the working tree.
Planning against HEAD is how the observability work got built twice.

**Verify HEAD runs, not just the working tree.** Commit `b2e70c0` shipped the
Explorer without `schema.sql`; the tests passed only because they ran against
the uncommitted file.

## Building a feature: the checklist

1. **Server.**
   - New tables go in `server/src/state/schema.sql` as `CREATE TABLE IF NOT
     EXISTS`.
   - Logic goes in its own folder (see `server/src/projects/`).
   - Routes use zod bodies. Writes carry `expectedVersion` and answer `409
     stale_version` when stale. Destructive operations get their own endpoint.
   - Mount routes in `server/src/index.ts`.
2. **AVA's tools.** Add `server/src/tools/<feature>-mcp.ts`, wire it into both
   tool lists in `server/src/routes/chat.ts`, and add a short section to
   `server/src/orchestrator/tool-rubric.ts`.
3. **Voice speed.** Anything Niko says that should happen at once (add, remove,
   log, "what's on") goes through the fast lane: `server/src/lookups/`
   (`fast-lookup.ts`, and `project-actions.ts` as the pattern). A small model
   picks one action and AVA does it directly in about 2 s instead of the
   agent's ~40 s. Unclear requests fall through to the agent.
4. **Web.**
   - Use only the design system in `web/src/design/` (`index.ts`, plus
     `metal/` for MetalObject and Atmosphere; live gallery at `?design-gallery`).
   - Screen styles go in `web/src/design/tokens.css`, the only place raw
     colours may appear. Copy the Calendar/Projects workspace layout.
   - Add the screen to `migrated` in `web/src/design/design-guard.baseline.json`.
   - Register it in `web/src/App.tsx` (view, destination, render).
5. **Tests.**
   - Run the full server and web vitest suites.
   - Take desktop (1440) and phone (390) screenshots with Playwright
     (`channel: "msedge"`) of a scratch preview such as
     `web/projects-preview.tsx` served by Vite. Look at them before saying it
     works.
   - Previews are never committed.
6. **Review.** For a big feature, have one reviewer agent read the diff before
   it goes live.
7. **Commit.** Path-scoped only (`git add -- <your files>`), ending with the
   Co-Authored-By line. Never push.
8. **Deploy**, only when Niko isn't talking to AVA (ask him, or check that the
   newest message is more than 10 minutes old):
   - `npm run build` in `server/`, then in `web/`;
   - run `scripts/start-ava-desktop-runtime.ps1`;
   - confirm `/api/health` shows the new `buildId`.
9. **Tell AVA what shipped.** Write `{phase, title, detail, commits}` to
   `$TEMP/claude-note-entry.json`, then run `npx tsx scripts/claude-note.ts`
   from `server/`. Use plain words Niko would say.

## Standing rules

Never:
- push to GitHub;
- stage `.claude/settings.local.json`, `.codex/*`, `AGENTS.md`, `CLAUDE.md`,
  `.gitignore` or `first-proj`;
- print, copy or commit tokens or keys (`.env`, VAPID keys, pairing tokens);
- touch Forge (a separate project);
- post the agentroom room link;
- serve, bundle or commit the private source portrait behind AVA's face;
- rewrite Niko's own `personality.md` at the repo root;
- bypass a permission or classifier denial, or edit your own permissions;
- restart AVA while Niko is on a call.

Always:
- keep personal and evaluation data in gitignored `data/`. Committed docs and
  tests use synthetic data and no third-party phone numbers;
- give a cost estimate before big OpenAI runs. Live AVA uses the same credits,
  so stop at the first 429;
- write code that contains backslashes with the Write/Edit tools. Shell
  heredocs and `node -e` strings on this machine eat backslashes and turn `\n`
  into real line breaks, which has broken regexes and strings here several
  times.
