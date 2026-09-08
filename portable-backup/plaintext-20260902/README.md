# AVA plaintext private-repository snapshot — 2026-09-02

This directory contains a complete plaintext portable snapshot of AVA's
captured non-`.git` folder contents. It includes tracked source, ignored
`.env`, SQLite databases, browser/session data, dependencies, build output,
logs, local integration runtimes, and unrelated working-tree files present at
capture time.

It is deliberately **not encrypted** at Niko's request. Keep the GitHub
repository private. Anyone who can read this branch can recover the captured
credentials and session material.

## Restore

Follow `docs/RUN-AVA-ON-ANOTHER-PC.md` on `master`, or clone `master`, add this
branch as a second worktree, and run:

```powershell
powershell.exe -ExecutionPolicy Bypass -File `
  ..\AVA-plaintext-backup\portable-backup\plaintext-20260902\RESTORE.ps1 `
  -TargetPath (Resolve-Path .).Path
```

The script checks every split-volume SHA-256 value, extracts and hashes the
inner archive, tests its 7-Zip structure, overlays only a specific existing
clone named `AVA`, preserves that clone's `.git`, and imports the included
non-backup local refs beneath `refs/heads/restored/`.

## Layout

- `AVA-plaintext-git-20260902.7z.001` through `.246`: unencrypted 20 MiB
  Git-safe split wrapper volumes containing both verified inner archives.
- `SHA256SUMS.txt`: SHA-256 for every uploaded wrapper part.
- `INNER-SHA256SUMS.txt`: SHA-256 for the full inner archive after wrapper
  extraction.
- `BACKUP-METADATA.json`: capture counts, branch/commit, bounds, and private
  repository verification.
- `RESTORE.ps1`: guarded restore and Git-bundle import.

The root `.git` directory is the sole structural exception. A commit cannot
contain the object database that recursively contains the same backup commit.
GitHub supplies the remote object database through the clone, while the inner
archive carries a verified Git bundle of all non-backup local branches. Nested
`.git` directories inside AVA runtime dependencies are ordinary captured data
and remain in the archive.
