# Ava M1 smoke test

Run this checklist after `install-autostart.ps1` succeeds.

## On the PC

- [ ] `http://localhost:8787/_status` loads, shows uptime > 0.
- [ ] `http://localhost:8787/api/health` returns `{"ok":true,...}`.
- [ ] Right-click the systray icon → "Show pairing code" → MessageBox appears with a 6-character code.
- [ ] `http://localhost:8787/` loads the PWA shell (pairing screen).

## On the phone (same Tailscale tailnet)

- [ ] `http://<pc-tailscale-name>:8787/` loads, shows the pairing screen.
- [ ] Add the page to the home screen (iOS Safari → Share → Add to Home Screen).
- [ ] Open from the home-screen icon — confirm standalone display.
- [ ] Enter the pairing code and a label. Pair succeeds. Chat screen appears.
- [ ] Type "list the contents of my user home folder". Press Send.
- [ ] Activity strip shows `→ shell({"command":"..."})` then `← shell ok`.
- [ ] A bubble with the listing appears.
- [ ] Background the PWA for 30s, return — chat history is intact (events replayed via `lastEventId` or `gap` event surfaced).
- [ ] Type a long-running command ("ls -la C:/" works) and tap Stop mid-stream — see `stopped.` line.
- [ ] Reboot the PC. After reboot, the PWA reconnects without re-pairing.

## Failure modes verified

- [ ] Tear down the pairing token in Settings (manual revoke via `DELETE /api/auth/devices/:id`); confirm the PWA gets 401 on the next request.
- [ ] Stop pm2 (`pm2 stop ava`); PWA shows a "server offline" indicator.
- [ ] Restart pm2; PWA reconnects.

## M2 Phase 1 — Real tools

Run from the phone PWA, paired and on the same Tailscale tailnet (or LAN during dev).

### Filesystem
- [ ] "Read C:/ai/chemiapebi/yovlisshemdzle/package.json and tell me the workspaces" → see `tool_call: fs_read`, then a real summary.
- [ ] "List the files in C:/Windows" → server returns a deny ("not in allowlist"); agent reports honestly.
- [ ] "Read C:/ai/chemiapebi/.env" → blocked at tool layer; agent reports the .env hard-block.
- [ ] "Write 'hi' to C:/ai/chemiapebi/yovlisshemdzle/scratch.txt then read it back" → both succeed.

### claude_code
- [ ] "Use claude_code to summarize the project at C:/ai/chemiapebi/yovlisshemdzle" → see `tool_call: claude_code`, then a result. Pidfile appears under `data/pidfiles/<runId>/<pid>` while running, then is removed.
- [ ] During a long claude_code run, hit the kill switch on the phone. Worker process terminates within ~2s; pidfiles directory is cleared.
- [ ] Send a prompt containing `--dangerously-skip-permissions` → blocked at tool layer.

### Chrome
- [ ] "Open chrome to https://news.ycombinator.com" → first call boots chromium with the persistent profile; subsequent calls reuse it.
- [ ] "Read the page" → returns innerText of the body.
- [ ] "Take a screenshot" → returns a file path under `data/screenshots/`.
- [ ] Reboot the PC, run again — chrome's profile dir's stale `SingletonLock` is removed automatically; chromium launches.
