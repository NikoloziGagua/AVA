# AVA face asset build

This directory turns AVA's private portrait into the derived, renderer-ready
asset used by `FaceStage`. The original image is input-only: the scripts never
copy, move, delete, serve beyond a loopback-only build page, or commit it.

## Rebuild

Provision the pinned build-time models once:

```powershell
npm.cmd -w server run face:provision
```

Then build from a private path:

```powershell
npm.cmd -w server run face:build -- --input C:\private\ava.png
```

The build refuses to run when any model file, version, SHA-256 or licence pin
is missing. Model files live under ignored `server/data/face/models`; neither
they nor the portrait ship in the web application. The only committed output
is `web/public/face/manifest.json` plus the content-addressed `.bin` containing
quantised points, 478 face landmarks and a 200x200 depth grid.

The generator is deterministic for the same portrait, pinned models and seed.
It validates the completed pair before replacing the public manifest, retains
the previous pair until the new pair is valid, and deletes older derived binary
versions only after publication succeeds.

## Verification

```powershell
npm.cmd -w server run face:test
npm.cmd -w web run build
npm.cmd -w web run build:managed
```

The canonical and managed builds both copy and precache the manifest/binary.
The production verifier independently checks their content hash and byte count.
