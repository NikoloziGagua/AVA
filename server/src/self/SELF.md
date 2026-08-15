# Ava — self-knowledge

Ava is a personal AI agent that runs on the user's Windows PC, controlled from a phone PWA over Tailscale.

## Repository
Monorepo (npm workspaces).
- `server/` — Node/TypeScript Express server: the orchestrator + tool host (workspace `ava-server`).
- `web/` — Vite + React 19 PWA: the mobile control interface (workspace `ava-web`).

## Commands
- Test (all): `npm test`
- Test server only: `npm -w server run test`
- Typecheck: `npx tsc --noEmit -p server/tsconfig.json` and `npx tsc -b web`
- Build: `npm -w web run build` then `npm -w server run build`
- Run (dev): `npm -w server run dev` (tsx watch; serves the built PWA + API on PORT, default 8787)

## Server module map (server/src)
- `orchestrator/` — the agent loop (`agent.ts`), system prompt, LLM providers (`llm/`), intent/greeting/summary helpers, reasoning tier.
- `tools/` — tools exposed to the agent: `claude_code`, `chrome`, `shell`, `filesystem`, `computer_use`, `memory`, `self_improve` (each has an `*-mcp.ts` definition).
- `memory/` — durable memory: observations, preferences, projects, personality; secret-scrubbed on write (`store.ts`).
- `playbooks/` — procedural memory: distil a successful multi-step run into a reusable playbook (`distill.ts`), match a request to one (`match.ts`), capture/recall wired in `routes/chat.ts`.
- `policy/` — risk classification + approval enforcement for tool calls.
- `routes/` — Express routes: chat (SSE), sessions, auth, rules, approvals, voice, voice-realtime (WS proxy), memory, reasoning, self.
- `state/` — better-sqlite3 access; schema in `state/schema.sql` (applied on `openDb`).
- `self/` — THIS self-improvement system.
- `auth/`, `security/`, `push/`, `process/`, `sse/`, `systray/` — supporting subsystems.

## Web module map (web/src)
- `chat/`, `voice/`, `orbit/`, `memory/`, `rules/`, `self/` — screens; `components/ava` — animated UI primitives.

## Conventions
- TDD throughout: every module has a co-located `*.test.ts`. Write the failing test first.
- Small, focused files, one responsibility each.
- Secrets are scrubbed at the memory store layer and in logs (`security/scrub.ts`).

## Self-improvement workers
- New improvement intents snapshot the versioned Self-screen choice: `claude` or `codex`.
- Both workers edit only an isolated git worktree and enter the identical approval, verify, safety, swap, watchdog, and rollback gates.
- Missing or unauthenticated CLIs fail closed; there is no silent provider fallback.
