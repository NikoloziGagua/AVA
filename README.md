# Ava

Personal AI agent on Windows, controlled from a phone PWA over Tailscale.

## Workspaces

- `m0-spike/` — throwaway spike to validate Claude Agent SDK and custom MCP tool integration
- `server/` — Node/TypeScript Express server; the orchestrator and tool host
- `web/` — Vite + React 19 PWA; the mobile control interface

## Docs

- Design: `docs/superpowers/specs/2026-04-27-ava-design.md`
- Plan: `docs/superpowers/plans/2026-04-27-ava-m0-m1.md`

## Auto-start on Windows

Open PowerShell **as Administrator** and run:

```powershell
.\scripts\install-autostart.ps1
```

This builds the server + PWA, installs `pm2` + `pm2-windows-startup` globally, and configures Ava to launch on boot.

To stop autostart: `pm2-startup uninstall && pm2 delete ava`.
