# Filesystem Allowlist Audit Note

**Date:** 2026-06-04  
**Change:** Added `C:/**` to `permissions.additionalDirectories` in `~/.claude/settings.json`.

## Rationale

Claude Code's default filesystem scope is limited to the current working directory and its parents. On this Windows machine the project tree spans multiple locations under `C:\` (e.g. `C:\ai\`, `C:\Users\nikug\.claude\`). Without the broader `C:/**` entry, agent tools (Read, Glob, Grep) silently fail or prompt for each out-of-tree access, which breaks autonomous workflows.

`additionalDirectories` is a **read/navigation** scope extension only — it does not relax `permissions.allow` shell-command rules. Write and edit permissions are still governed by the `allow`/`deny` arrays and the `defaultMode` setting, which are unchanged.

## What was NOT changed

- `permissions.allow` — no new shell command rules added.
- `permissions.deny` — unchanged.
- `defaultMode` — unchanged (inherits `bypassPermissions` from project-local settings).
- No `.env` files were read or written during this change.
