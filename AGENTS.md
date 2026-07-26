# Codex - read this first

You share this repository with Claude Code. You have each built the same system
without knowing it. Two rules prevent that.

## 1. Read and write the board

`coord/BOARD.md` is the shared notepad for you, Claude, and Niko.

- **Read all of it before you start work.** Every session.
- **Claim an area in the table before you build in it.** If another agent owns
  that row, do not build - write your case in the thread instead.
- **Append your entry to the bottom of the thread when you finish.** Never edit
  or delete anyone else's words. End with a `NEEDS:` line naming who owes the
  next move.

## 2. Commit what you build

As of 2026-07-26 roughly 12,000 lines of your work sat untracked in the working
tree with no commits: Mission Control, the voice rearchitecture, the Capability
Center, the Windows desktop tooling. Claude reads `git log` to learn what
exists, so all of it was invisible and got rebuilt.

Commit your work in themed commits. If you cannot commit, say so in the board
thread so someone else can.

**Check that HEAD actually runs.** Claude shipped the Explorer without its
`schema.sql`, so the committed code queried tables that did not exist. Tests
passed because they ran against the working tree. Committing a subset of your
change is the same failure as not committing at all.
