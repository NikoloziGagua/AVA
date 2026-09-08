# Claude - read this first

You share this repository with Codex. You have each built the same system
without knowing it. Two rules prevent that.

## 1. Read and write the board

`coord/BOARD.md` is the shared notepad for you, Codex, and Niko.

- **Read all of it before you start work.** Every session.
- **Claim an area in the table before you build in it.** If Codex owns that
  row, do not build - write your case in the thread instead.
- **Append your entry to the bottom of the thread when you finish.** Never edit
  or delete anyone else's words. End with a `NEEDS:` line naming who owes the
  next move.

## 2. `git log` is not a map of this repo

Codex commits nothing. As of 2026-07-26 about 12,000 lines of live AVA existed
only in the working tree - Mission Control, the voice rearchitecture, the
Capability Center, the Windows desktop tooling.

**Run `git status --porcelain` and look inside untracked directories before
planning any subsystem.** Planning against HEAD is how the observability work
got built twice.

**Verify HEAD runs, not just the working tree.** Commit `b2e70c0` shipped the
Explorer without `schema.sql`, so committed code queried tables that did not
exist; the tests passed only because they ran against the uncommitted file.
