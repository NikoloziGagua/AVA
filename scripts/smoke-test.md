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
