# Run AVA on another Windows PC

This guide covers two different restores:

- **Clean install:** clone `master`, install dependencies, add provider keys,
  build, and run AVA with fresh local data.
- **Exact portable restore:** clone the repository and overlay the plaintext
  portable snapshot from `backup/plaintext-full-20260902`. This restores the
  captured `.env`, databases, browser profile, installed dependencies, logs,
  local integration runtimes, and other ignored/runtime files.

The portable snapshot contains credentials and signed-in browser/session data
in plaintext. The GitHub repository must remain private. If it is ever made
public, immediately make it private again and rotate every API key, session,
token, cookie, webhook secret, and account credential stored by AVA.

## Requirements

Use Windows 10 or 11 with an interactive desktop session. Install:

1. [Git for Windows](https://git-scm.com/download/win)
2. [Node.js 24 or newer](https://nodejs.org/)
3. [Google Chrome](https://www.google.com/chrome/)
4. [7-Zip](https://www.7-zip.org/) for the exact portable restore
5. PowerShell 5.1 or newer (included with Windows)

Optional capabilities have additional requirements:

- Microsoft UFO's fixed Notepad proof needs Git, Python 3.10, an OpenAI key,
  and `npm.cmd -w server run setup:ufo-runtime` when its copied environment is
  not portable to the new machine.
- Activepieces setup can be repaired with
  `powershell.exe -ExecutionPolicy Bypass -File .\scripts\setup-activepieces-runtime.ps1`.
- Phone access needs Tailscale installed and signed in on both devices.

## Option A: clean source install

Open PowerShell in the folder where AVA should live:

```powershell
git clone https://github.com/NikoloziGagua/AVA.git
Set-Location .\AVA
Copy-Item .env.example .env
notepad .env
```

Because the repository is private, GitHub will ask you to authenticate through
Git Credential Manager, SSH, or a personal access token. At minimum, set one
provider in `.env`:

```dotenv
LLM_PROVIDER=openai
OPENAI_API_KEY=your-key-here
```

Anthropic can be used instead by setting `LLM_PROVIDER=anthropic` and
`ANTHROPIC_API_KEY`. Then install and build:

```powershell
npm.cmd ci
npm.cmd -w server run build
npm.cmd -w web run build
```

Start AVA normally:

```powershell
.\RUN-AVA.cmd
```

Open <http://127.0.0.1:8787>. Check
<http://127.0.0.1:8787/api/health> if the interface does not load.

For automatic startup and AVA's persistent visible Chrome, run this once from
a normal, non-administrator PowerShell:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\install-autostart.ps1
```

AVA opens a dedicated Chrome profile. Sign in to Instagram, WhatsApp Web,
Gmail, and other sites in that AVA Chrome window. Those sessions are stored
under `server\data\chrome-profile`.

## Option B: restore the exact captured AVA

Use this when you want the current AVA data and configuration rather than a
fresh installation.

### 1. Clone the private repository

```powershell
git clone https://github.com/NikoloziGagua/AVA.git
Set-Location .\AVA
```

Do not run AVA yet.

### 2. Download the plaintext backup branch

The branch is `backup/plaintext-full-20260902`. Its
`portable-backup/plaintext-20260902` directory contains numbered 7-Zip parts,
checksums, restore instructions, and a restore script.

The easiest method is to use a second working directory:

```powershell
git worktree add ..\AVA-plaintext-backup backup/plaintext-full-20260902
```

Then run the restore script from the repository clone:

```powershell
powershell.exe -ExecutionPolicy Bypass -File `
  ..\AVA-plaintext-backup\portable-backup\plaintext-20260902\RESTORE.ps1 `
  -TargetPath (Resolve-Path .).Path
```

The script verifies the chunk hashes and archive integrity before overlaying
the captured AVA files. It refuses unsafe targets and does not replace the
clone's `.git` directory.

If restoring manually, verify `SHA256SUMS.txt`, open the `.7z.001` part with
7-Zip, extract the inner archive, and overlay the extracted `AVA` directory on
the clone. Do not extract into an unrelated folder that contains personal
files.

### 3. Rebuild native and machine-specific parts

The snapshot carries `node_modules`, but native packages and absolute paths may
depend on the original Windows installation. Reinstalling is the reliable
choice on a different PC:

```powershell
npm.cmd ci
npm.cmd -w server run build
npm.cmd -w web run build
```

The captured Chrome profile is present, but Windows-protected cookies or login
tokens may not decrypt under a different Windows account or machine. Open AVA
Chrome and sign in again wherever required. Do not interpret a copied profile
as proof that an account is still authenticated.

If the copied Microsoft UFO or Activepieces environment does not start because
of native paths or host policy, repair it with the optional setup commands in
the Requirements section. Core AVA does not require either integration.

### 4. Install the desktop runtime and start

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\install-autostart.ps1
.\RUN-AVA.cmd
```

Verify:

```powershell
$health = Invoke-RestMethod http://127.0.0.1:8787/api/health
$health | ConvertTo-Json -Depth 5
```

`ok` should be `true`. `ready` is `true` when a configured model provider is
usable. The first browser visit may ask for a pairing code. Generate one from
the repository root with:

```powershell
npm.cmd -w server run pair
```

## Phone access

Install and sign in to Tailscale on the AVA PC, run:

```powershell
tailscale ip -4
```

Set that address as `TAILSCALE_IP` in `.env`, restart AVA, and open
`http://<tailscale-ip>:8787` from the phone connected to the same tailnet.

## What the portable snapshot does and does not contain

The plaintext portable archive contains every captured file under the AVA
folder except the repository's live `.git` directory. That exception is
unavoidable: a Git commit cannot recursively contain the object database that
contains that same commit and archive. A normal clone supplies the remote Git
history, and the snapshot includes a verified Git bundle of all non-backup
local branches so unique local history can be recovered without recursion.

The archive is the data backup; `master` remains the readable source branch.
Generated build output and copied dependencies are included in the portable
snapshot, but rebuilding after moving to another computer is still recommended.

## Troubleshooting

- **`ready: false` / `no_llm_provider`:** add a valid OpenAI or Anthropic key
  to the root `.env`, then restart.
- **Port 8787 is occupied:** run `RUN-AVA.cmd`; AVA's launcher replaces only a
  listener that identifies itself as an older AVA build. Stop unrelated
  software yourself if it owns that port.
- **Chrome is not ready:** confirm Chrome is installed, then run
  `powershell.exe -ExecutionPolicy Bypass -File .\scripts\start-ava-browser.ps1`.
- **Activepieces fails:** AVA core can still run. Inspect
  `logs\activepieces-runtime-error.log`, then rerun its setup if needed.
- **A copied login no longer works:** sign in again in AVA's dedicated Chrome;
  Windows may bind encrypted cookies to the original account or machine.
- **Private clone fails:** authenticate GitHub for the account that owns or has
  access to `NikoloziGagua/AVA`.

