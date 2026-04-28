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

## M2 Phase 2 — Polish, sessions, push, recovery

### Logger
- [ ] Hit `/api/health` once, then check `server/data/logs/server-YYYY-MM-DD*.log` exists and contains JSON lines.
- [ ] Send a chat message containing `sk-ant-fake12345`. The transcript and message DB show the original; logs for the request show `sk-ant-***`.

### Sessions screen
- [ ] In the PWA, tap the hamburger (☰) on the chat header. Sessions list opens, newest-first.
- [ ] Tap an old session → its transcript loads in chat.
- [ ] Tap "+ new" → empty chat appears; first message creates a new session.

### Auto-title
- [ ] Send a fresh message like "explore the structure of this repo and tell me where the auth code lives". Within ~2 seconds, refresh the sessions list — the title should be a 3-7 word phrase, not the truncated message.
- [ ] Block outgoing requests to api.anthropic.com via a hosts entry; send a new message; verify the title falls back to the truncation.

### Auto-summary
- [ ] In a session, send 60+ messages quickly (a script/copy-paste). On the 51st, observe a brief delay before the agent responds. Verify in the DB: `SELECT summary, summary_through_message_id FROM sessions WHERE id=...`.
- [ ] Block api.anthropic.com mid-summarize; verify the agent still responds (no summary stored, raw transcript used).

### Push subscription
- [ ] Tap "enable notifications" on the PWA. Grant permission. Verify `SELECT endpoint FROM push_subscriptions;` returns one row.
- [ ] Revoke notification permission in browser settings, reload, tap again — should re-register cleanly.

### pm2 boot recovery
- [ ] Start server, send a long claude_code prompt; while it's running, `taskkill /F /PID <node-pid>` of the server (not Ctrl+C). Confirm orphan claude.exe in Task Manager.
- [ ] Restart server. Verify the orphan claude.exe is gone, `data/pidfiles/` is empty, and the session that was running is now `status='interrupted'` with a trailing system message in the transcript.

## M3 — Policy, approvals, push, voice, computer_use

### Policy + approvals
- [ ] Send "run `rm -rf C:/tmp/x`" — chat shows an approval card; tap **Approve** → tool executes; tap **Deny** in a second run → tool reports "denied".
- [ ] Send "read C:/ai/chemiapebi/.env" — server returns `BLOCKED` without surfacing an approval card (hard-block).
- [ ] Open the Rules screen; add "always allow `git status` in this repo"; the next `git status` runs without asking.

### Per-tool timeout
- [ ] In a shell prompt, ask the agent to run `timeout 60` (or `Start-Sleep -Seconds 60`); after 30s the tool result line shows `timeout`.

### Stuck-loop guard
- [ ] Ask the agent to take 6 screenshots of `about:blank` in a row; after the 5th identical screenshot, the run halts with the "I've been trying for a while…" message and a `killed` event with reason `stuck`.

### Push delivery
- [ ] Phone has push enabled (M2 step). Trigger an approval-required prompt while the PWA is backgrounded → a Web Push notification arrives with **Approve / Deny** buttons (Android) or a tap-to-open card (iOS).

### computer_use
- [ ] "Use computer_use to find the headline at https://news.ycombinator.com" → tool emits `tool_call: computer_use`, drives chrome via mouse/keyboard, returns a summary referencing the headline.

### Voice
- [ ] `curl -F audio=@hello.webm -H "Authorization: Bearer <token>" http://localhost:8787/api/transcribe` → JSON `{ "text": "..." }`.
- [ ] `curl -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{"text":"hi"}' http://localhost:8787/api/speak -o out.mp3` → playable mp3.
