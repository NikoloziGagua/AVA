# Ava architecture — deep dives

Start with the overview: **[`../ARCHITECTURE.md`](../ARCHITECTURE.md)** — the top-to-bottom map plus the end-to-end workflows. These nine companion docs are the exhaustive, code-verified detail for each subsystem (diagrams, step-by-step workflows, `path:line` citations, and honest notes on what's flaky or half-built).

| # | Doc | Covers |
|---|-----|--------|
| 01 | [Bootstrap & ops](01-bootstrap-and-ops.md) | Boot sequence, config + env vars, networking, logging, systray, recovery, ops runbook |
| 02 | [Agent loop & orchestration](02-agent-loop-and-orchestration.md) | Run lifecycle, the reasoning/tool loop, LLM providers, SSE streaming, abort/Stop |
| 03 | [Tools catalog](03-tools-catalog.md) | Every tool — inputs, execution, API cost, gating, the tool-selection rubric |
| 04 | [Safety, policy & approvals](04-safety-policy-approvals.md) | Risk tiers, user rules, the 15s veto, approvals + push, the hard blocks |
| 05 | [Auth, sessions & data model](05-auth-sessions-data-model.md) | Pairing, tokens, sessions/messages, and the full SQLite schema |
| 06 | [Voice pipeline](06-voice-pipeline.md) | Both providers (OpenAI + Hume), the gate, hybrid handoff, audio, the web client |
| 07 | [Self-improvement](07-self-improvement.md) | Ava editing its own code: reflect → worktree → verify → swap → watchdog, and its gaps |
| 08 | [Memory, learning & identity](08-memory-learning-identity.md) | Memory files, system-prompt assembly, playbooks, suggestion chips, the dev log |
| 09 | [Web frontend](09-web-frontend.md) | The React PWA — view routing, chat/voice screens, the API client, the service worker |

**Conventions:** the reader is addressed as "you" / "the owner" (the runtime persona's own "Sir" is documented where relevant, not used to address you). Current usage is a desktop browser on the PC; Tailscale/PWA make remote use possible but it isn't assumed.

Maintained by the `doc-writer` agent (`.claude/agents/doc-writer.md`).
