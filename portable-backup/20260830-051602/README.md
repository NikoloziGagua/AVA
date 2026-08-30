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

The encryption key is intentionally not stored in GitHub. Keep the separately
provided key. Without it, neither the inner archive's filenames nor contents
can be recovered.

## Restore

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

The final extraction creates the top-level `AVA` directory, including its
`.git` metadata and the exact local data captured at snapshot time.
