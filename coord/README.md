# Coordination board writer

`coord/BOARD.md` is an append-only human record. Its headings, separators and
`NEEDS:` lines repeat thousands of times, so text-anchor patches are not a safe
way to append: a patch can match an earlier occurrence and silently break the
chronology.

AVA's repository-owned writer appends by bytes at physical EOF. It uses an
adjacent exclusive lock, re-reads the file under that lock, requires the exact
length-plus-SHA-256 version observed by the caller, writes with OS append mode,
flushes the file, and verifies that every prior byte is unchanged. Cooperative
simultaneous writers serialize; a writer with a stale version fails clearly and
must re-read rather than guessing where its entry belongs.

## Agent workflow

1. Read the whole board once at the start of the session.
2. Immediately before each append, re-read its physical tail.
3. Capture the exact current version:

   ```powershell
   $boardVersion = npm run board:status --silent
   ```

4. Put the complete entry in a temporary UTF-8 file outside the repository.
   The entry must include its final `NEEDS: niko`, `codex`, `claude`, or
   `nobody` handoff. Then append it:

   ```powershell
   npm run board:append --silent -- --expected-version $boardVersion --entry-file C:\path\to\entry.md
   ```

   For automation, `--entry-base64 <base64-utf8>` and stdin are also supported.
   The success JSON returns the previous/current versions and byte counts.

5. If the command returns `STALE_BOARD`, another writer won. Re-read the tail,
   ensure the new entry does not conflict with the claim, capture a new version,
   and retry. If it returns `LOCK_TIMEOUT`, wait briefly and follow the same
   re-read procedure. Never fall back to an anchor patch.

The writer converts only the new entry's line endings to the board's dominant
LF or CRLF convention and ensures a blank-line boundary. It never normalizes or
rewrites existing bytes. Entry size is bounded to 128 KiB. Locks older than 30
seconds are recovered only when they are malformed or their same-host owner is
no longer alive; a live or remote-owner lock is not stolen.

The lock coordinates callers using this writer. A non-cooperating editor can
still change the file; the post-write integrity check detects that condition
and reports it instead of claiming a clean append. Git's existing Self-worktree
append-only merge remains the later branch-reconciliation boundary, not the
primary write mechanism.
