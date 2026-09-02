# AVA full portable snapshot — 2026-08-30

This branch stores one complete encrypted snapshot of the local `AVA` folder.
It includes source history, ignored files, `.env`, runtime databases, browser
profile/session data, logs, dependencies, Activepieces data, UFO runtime files,
and every other file present while AVA was quiesced.

## Snapshot facts

- Source commit before snapshot: `c86c1a2c34a631dc97d3258957e6b3d721df86cc`
- Source folders: `68,773`
- Source files: `379,609`
- Source bytes: `9,574,632,618`
- Encrypted archive bytes: `5,151,029,352`
- Inner archive: split 7z, AES-256, encrypted filenames
- Inner archive integrity: 7-Zip reported `Everything is Ok` for all files
- Upload wrapper: uncompressed 90 MiB 7z volumes, used only to stay below
  GitHub's ordinary per-file limit after the repository's LFS budget rejected
  the direct upload

## Earlier current-state delta — 2026-09-01

The baseline upload took long enough that runtime state advanced and one new
Codex agent file appeared afterward. AVA was quiesced again and every file
created or modified since the baseline cutoff was captured in a second
AES-256 archive with encrypted filenames:

- Changed or created files: `2,223`
- Uncompressed bytes: `176,467,684`
- Encrypted delta bytes: `37,199,460`
- Integrity result: 7-Zip reported `Everything is Ok` for all 2,223 entries
- Checksum: `DELTA-SHA256SUMS.txt`

This delta is retained as immutable evidence of the September 1 capture. The
newer cumulative September 2 refresh below supersedes it for a current restore.

## Current cumulative refresh — 2026-09-02

AVA was quiesced again after the latest frontend, Notes and durable-memory work.
`AVA-cumulative-delta-20260902.7z` contains every file created or changed since
the original baseline cutoff, including ignored `.env`/runtime state when it
changed, plus a complete current inventory, content hashes for the delta, an
explicit deletion manifest and a Git bundle for every non-backup local branch.

- Current filesystem inventory: `395,584` entries / `19,907,547,277` bytes
- Cumulative changed entries archived: `2,786`
- Cumulative changed source/runtime bytes: `184,404,490`
- Deleted baseline files recorded: `44`
- Inventory or content-hash skips: `0`
- Encrypted refresh bytes: `33,325,092`
- Archive integrity: 7-Zip reported `Everything is Ok` for `2,794` files
- Checksum: `REFRESH-20260902-SHA256SUMS.txt`
- Source head at capture: `4a8ae5febb659746db825e07bf0c6eef08c72fcb`

The live `.git/objects`, `.git/lfs` and local backup-branch refs contain or point
to the uploaded backup blobs themselves. Embedding those paths in their own next
backup commit would create an infinite self-reference. They are represented by
the remote backup branch plus the encrypted non-backup-refs bundle rather than
copied recursively. No source history or unique local branch is omitted by that
boundary.

The encryption key is intentionally not stored in GitHub. Keep the separately
provided key. Without it, neither the inner archive's filenames nor contents
can be recovered.

## Restore

The recommended path is `RESTORE-CURRENT.ps1`. It verifies both archive layers,
prompts for the separately held key, restores the baseline, overlays the latest
cumulative refresh, applies the deletion manifest and imports the bundled local
Git refs. Restore where an `AVA` folder does not already exist:

```powershell
powershell -ExecutionPolicy Bypass -File .\RESTORE-CURRENT.ps1 -DestinationRoot C:\Users\nikug\ai
```

Manual equivalent:

1. Clone or download this branch and place all
   `AVA-full-20260830-upload.7z.*` volumes in one folder.
2. Install 7-Zip 26.02 or a compatible version.
3. Verify all SHA-256 values in `SHA256SUMS.txt`.
4. Reconstruct the three encrypted inner volumes:

   ```powershell
   & 'C:\Program Files\7-Zip\7z.exe' x '.\AVA-full-20260830-upload.7z.001' '-o.\inner'
   ```

5. Extract the complete AVA directory using the separately supplied key:

   ```powershell
   & 'C:\Program Files\7-Zip\7z.exe' x '.\inner\AVA-full-20260830.7z.001' '-pYOUR-SEPARATE-KEY' '-oC:\Users\nikug\ai'
   ```

6. Overlay the encrypted cumulative refresh into the restored AVA directory:

   ```powershell
   & 'C:\Program Files\7-Zip\7z.exe' x '.\AVA-cumulative-delta-20260902.7z' '-pYOUR-SEPARATE-KEY' '-oC:\Users\nikug\ai\AVA' -aoa
   ```

7. Apply `.ava-backup-metadata\deleted-since-baseline-20260902.txt`, import
   `.ava-backup-metadata\AVA-git-nonbackup-refs-20260902.bundle`, then remove
   the temporary metadata folder. The restore script performs these steps with
   path-containment checks.

The result contains the top-level `AVA` directory, source and local branch
history, ignored configuration, application databases, browser/session state,
dependencies and all other data captured at the quiesced boundary.
