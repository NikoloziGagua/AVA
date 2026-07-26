# Ava

Personal AI agent on Windows, controlled from a phone PWA over Tailscale.

## First run

AVA needs an OpenAI or Anthropic API key before chat can work:

```powershell
Copy-Item .env.example .env
notepad .env
npm.cmd install
npm.cmd -w server run build
npm.cmd -w web run build
npm.cmd -w server run start
```

Set `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` in `.env`. AVA loads both
`server/.env` and the repository-root `.env`, and always stores its default
runtime state under `server/data` regardless of which directory launches it.

Open `http://localhost:8787/_status` to see whether AVA has a provider and how
many durable memory records are loaded. `GET /api/health` reports `ready: false`
and `issues: ["no_llm_provider"]` when the shell is running without a usable
chat provider.

For phone access, install and sign in to Tailscale on this PC, run
`tailscale ip -4`, and set that address as `TAILSCALE_IP` in `.env`.

## Workspaces

- `m0-spike/` — throwaway spike to validate Claude Agent SDK and custom MCP tool integration
- `server/` — Node/TypeScript Express server; the orchestrator and tool host
- `web/` — Vite + React 19 PWA; the mobile control interface

## Docs

- Design: `docs/superpowers/specs/2026-04-27-ava-design.md`
- Plan: `docs/superpowers/plans/2026-04-27-ava-m0-m1.md`

## Auto-start on Windows

Open a normal PowerShell and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-autostart.ps1
```

This builds the server + PWA and registers AVA in the current user's Windows
startup (`HKCU\...\Run`), without Administrator rights or UAC. Interactive mode
is required for AVA to open, foreground, and control the visible persistent
Chrome profile without inheriting a developer sandbox.

To stop autostart, remove `AVA Desktop Runtime` from the current user's Startup
apps (or from `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`).
