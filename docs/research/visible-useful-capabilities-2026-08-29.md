# AVA — Visible & Useful Capability Recommendations
**Date:** 2026-08-29  
**Scope:** Research and recommendation only. No implementation, installation, download, or watcher creation.  
**Basis:** Full reading of `coord/BOARD.md`, `docs/ARCHITECTURE.md`, `docs/AVA-CAPABILITIES.md`, `docs/ava-improvement-brainstorm.md`, `docs/2026-07-03-ava-roadmap-brainstorm.md`, feature docs, architecture deep-dives, git log (last 30 commits), `server/src/tools/` directory listing, recent reviews.  
**Method:** No external network calls, no live tool execution, no code changes.

---

## 1. Repository state at time of research

### Committed HEAD (`c28ad02` and recent history)

The last 30 commits (2026-07-03 to 2026-08-29) show:
- `feat(voice): add exact text input handoff` — voice-to-chat handoff with exact text seeding
- `feat(chat): render safe rich Markdown` — safe rich Markdown in assistant replies
- `feat(chat): add editable composer dictation` — dictation in the Composer
- `feat(automations): learn verified multi-step playbooks` — Activepieces playbook generation
- `feat(automations): add reusable Activepieces playbooks` — deterministic automation seam
- `feat(browser): add verified site and YouTube fast paths` — direct URL/YouTube routing
- `feat(browser): route direct Google searches` — Google fast path
- `feat(explorer): map Activepieces playbook capability`
- `feat(explorer): surface bounded Microsoft UFO runtime`
- `fix(self): execute approved Codex plans reliably`
- `fix(self): lock approved worker and isolate voice stop`
- `feat(self): select Claude or Codex worker`

### Working tree
`git status --porcelain` shows only:
- `M .claude/settings.local.json` (settings, not product code)
- `?? docs/reviews/2026-08-27-persona-framework-repository-research.md` (untracked review doc)

No significant untracked product code at time of research. The pattern of Codex leaving large untracked slices (described in BOARD.md history as of 2026-07-26) is no longer observed; recent BOARD thread entries confirm Codex has been committing its own work.

### Active BOARD claims (do not enter)
| Area | Owner | Status |
|------|-------|--------|
| Realtime voice pipeline | codex | active |
| Chat and voice input/presentation UX | codex | active |
| Semantic memory index | codex | active (phase 2) |
| Self-improvement worker selector | codex | active |
| Playbook verified-learning gate | codex | active |
| Watcher-to-Codex task delivery | codex | shipped |
| Measurement-first transparency pilot | codex | claimed |

### Unclaimed areas (safe to build in)
- Watches UI screen (API exists; `GET/POST/DELETE /api/watches` routes are complete; Memory screen has a section; a dedicated screen is explicitly flagged as "future UI" in `docs/features/watches.md`)
- Document/PDF reader tool (no tool exists; filesystem allowlist is in place)
- Windows native toast notifications (outbound; only web-push exists today)
- Daily Brief watch template / creation wizard
- Global hotkey launcher
- Persona behavioral dimensions

---

## 2. What AVA already has (inventory baseline)

| Capability | Evidence |
|-----------|---------|
| Text chat agent with full tool loop | `server/src/orchestrator/agent.ts`, `routes/chat.ts` |
| OpenAI Realtime voice (gpt-realtime-2.1, marin) | `routes/voice-realtime.ts`, `docs/architecture/06-voice-pipeline.md` |
| Persistent logged-in Chromium browser | `tools/chrome-mcp.ts`, `tools/chrome.ts` |
| Desktop screenshots + vision (`look_at_screen`) | `tools/screenshot/look-mcp.ts` |
| Native Windows app control (UI Automation + PowerShell) | `tools/control-app-mcp.ts` |
| File system read/write (allowlisted roots) | `tools/filesystem-mcp.ts` |
| Shell/PowerShell execution (allowlisted) | `tools/shell-tool.ts` |
| Durable memory (persona, preferences, observations, projects) | `server/data/memory/` |
| Semantic memory index with embeddings (SQLite) | `tools/memory-mcp.ts`, `state/schema.sql` |
| Playbook system (lexical recall, evidence-gated capture) | `playbooks/`, `docs/features/verified-learning-gate.md` |
| Watches / background monitoring + web-push | `watches/scheduler.ts`, `tools/watches-mcp.ts` |
| Self-improvement pipeline (Claude Code + Codex, worktree isolation) | `self/`, `docs/architecture/07-self-improvement.md` |
| Notes workspace (structured capture) | `tools/notes-mcp.ts`, `docs/features/notes.md` |
| Visual explanations (React Flow, research visuals) | `tools/visual-explanations-mcp.ts` |
| Activepieces deterministic playbooks | `tools/automations-mcp.ts`, `docs/features/activepieces-automations.md` |
| Computer execution routing (Google/YouTube/URL fast paths) | `orchestrator/computer-execution-router.ts` |
| Shopify Admin API integration (credential-gated) | `tools/shopify-mcp.ts` |
| Google Places API integration (credential-gated) | `tools/places-mcp.ts` |
| Rich Markdown rendering in chat | `chat/ChatScreen.tsx`, recent commit `3285a29` |
| Composer dictation | `docs/features/chat-composer-dictation.md` |
| Strategy Room | `state/schema.sql` (tables: `strategy_rooms`, `strategy_messages`, `strategy_events`) |
| Mission Control (observability) | `docs/features/mission-control.md` |
| Task result receipts | `docs/features/task-result-receipts.md` |
| Approval cards + web-push with Approve/Deny actions | `policy/`, `push/` |
| Self screen with goal box, Pause/Resume, Approve/Reject | `web/src/self/SelfScreen.tsx` |
| Persona v2 (`8d5f2ae`) | `docs/features/persona-v2.md` |

### Honest gaps in the current tool catalog

| Gap | Where documented |
|-----|-----------------|
| No PDF/document reader tool (only UTF-8 text files) | Inferred from `tools/filesystem-mcp.ts`; no `document_read` tool exists |
| No native Windows toast notifications (outbound) | Only web-push exists (`push/`); requires browser active |
| No dedicated Watches screen (UI) | `docs/features/watches.md`: "A JSON API exists for a future screen" |
| No global hotkey launcher | No entry in `tools/` or `scripts/` |
| No clipboard access tool | No `clipboard_read` tool; only via ad-hoc `shell` |
| No email/calendar direct API integration | Relies on browser automation |
| Playbook recall is lexical only | `docs/ARCHITECTURE.md §8`: paraphrase misses; semantic recall in agent loop is not wired |
| Watches have no UI creation wizard | Management only via chat or Memory > Standing watches section |

---

## 3. Candidate capabilities

The following eleven candidates were identified. Each is evaluated on the rubric below, then ranked.

**Evaluation dimensions:**
- **Delight/usefulness** — how much Niko will notice and value it daily
- **Overlap** — does anything equivalent already exist?
- **Integration fit** — how naturally it reuses existing seams (registry, policy, Mission Control, health)
- **Privacy/security** — does it expose new attack surface or leak data?
- **Licensing** — any third-party code/service?
- **Maintenance** — how likely to break without ongoing work?
- **Platform fit** — Windows PC, desktop browser, Tailscale
- **Cost** — metered API spend per use?
- **Reversibility** — can it be disabled cleanly?

---

### Candidate A — Watches UI Screen

**What it is:** A dedicated `/watches` screen (peer to `/self`) that renders all standing watches as cards with: schedule, status badge, last check result, last trigger time, pause/resume toggle, delete, and a "run now" button. A creation form (natural-language prompt + interval picker) mirrors `watch_create`.

**Repository evidence:**
- `routes/watches.ts` — `GET /api/watches`, `POST /api/watches`, `DELETE /api/watches/:id` are already implemented
- `docs/features/watches.md` — explicitly states: "A JSON API exists (`GET/POST/DELETE /api/watches`) for a **future screen**"
- `web/src/` — nav state machine in `App.tsx:17-25` shows `{ name: "memory" }` already navigates to a compound screen; a watches view follows the same pattern
- `state/schema.sql` — `watches` table has: `id, session_id, prompt, interval_minutes, enabled, once, last_run_at, last_status, last_result`
- `web/src/self/SelfScreen.tsx` — existing template: header + journal cards + action buttons; Watches screen is structurally identical

**Evaluation:**
| Dimension | Assessment |
|-----------|-----------|
| Delight/usefulness | **High** — Niko currently manages watches only through chat commands or a single Memory section; a dedicated screen makes "what am I monitoring?" instantly visible |
| Overlap | **None** — the API exists but has no screen |
| Integration fit | **Excellent** — reuses the exact API, state machine, nav pattern, and design tokens already in place |
| Privacy/security | **Low risk** — read-only display + destructive delete already requires confirm; no new permission surface |
| Licensing | **None** — pure AVA-internal |
| Maintenance | **Low** — no external dependency; mirrors Self screen structure |
| Platform fit | **Desktop-primary** — works well on the desktop browser |
| Cost | **None** — reads existing SQLite state |
| Reversibility | **Complete** — adding a view to the state machine is trivial to revert |

---

### Candidate B — Daily Brief Watch Template / Creation Wizard

**What it is:** A pre-built "morning brief" watch: a wizard in the UI (or a single chat command like "set up my morning brief") that creates a watch with a well-structured check prompt. The brief would include: pending approvals, active self-improvement states, Mission Control summary (recent verified vs failed), active watches, Notes pinned items, and (optionally) weather via the existing browser tool. Delivered as a push notification at a user-chosen time.

**Repository evidence:**
- `watches/scheduler.ts` — runs full agent turns; has access to all tools including `look_at_screen`, `fs_read`, browser
- `routes/watches.ts` — `POST /api/watches` accepts `{ prompt, interval_minutes, once }`
- `docs/features/watches.md` — "An ordinary watch is re-checked by AVA with her full toolset" — this is exactly what a brief needs
- `docs/AVA-CAPABILITIES.md §5` — confirms watches use full tool stack per check
- `docs/ARCHITECTURE.md §11` — "each check is a full, paid agent run" — cost is real but tolerable for once-daily
- `web/src/self/SelfScreen.tsx` — creation forms already exist for Self goals; same pattern applies

**Evaluation:**
| Dimension | Assessment |
|-----------|-----------|
| Delight/usefulness | **Very high** — habitual, daily touchpoint; makes AVA feel like a true ambient assistant |
| Overlap | **None** — watches exist but no template/wizard for a brief |
| Integration fit | **Excellent** — pure watch creation with a curated prompt; reuses Mission Control data, existing push infrastructure |
| Privacy/security | **Minimal new risk** — the prompt stays within AVA; brief output is push-notified (already VAPID-secured) |
| Licensing | **None** |
| Maintenance | **Low** — stable on top of watches infrastructure |
| Platform fit | **Desktop + phone** — push notification visible on both |
| Cost | **One full agent run per morning** (~same as a watch check); acceptable for daily cadence |
| Reversibility | **Complete** — deleting the watch removes the brief |

---

### Candidate C — Windows Native Toast Notifications (Outbound)

**What it is:** A secondary notification delivery channel that sends native Windows toast notifications (Action Center) alongside the existing web-push. Triggered by: watch fires, approval required, task done. Uses PowerShell's `New-BurntToastNotification` (BurntToast module, MIT) or `Windows.UI.Notifications` via PowerShell's WinRT bridge, which needs no separate install on Windows 10/11.

**Repository evidence:**
- `push/` — current delivery is VAPID web-push; requires the browser to be registered and active
- `tools/shell-tool.ts` — PowerShell is already the shell; `New-BurntToastNotification` is one PS call away
- `tools/control-app-mcp.ts` — PowerShell script invocation pattern already established
- `docs/ARCHITECTURE.md §5` — "fires a web-push notification, and waits up to 15 seconds" — a toast could be the second delivery within that window
- `scripts/` — already contains Windows-specific launch/startup scripts

**Windows Runtime (no BurntToast) path:** PowerShell 5.1 can reach WinRT directly:
```powershell
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
```
No third-party module required — this is built into Windows 10/11.

**Evaluation:**
| Dimension | Assessment |
|-----------|-----------|
| Delight/usefulness | **High** — makes AVA feel like a first-class Windows app; approval toasts appear even when the browser tab is backgrounded |
| Overlap | **Additive** to web-push; does not replace it |
| Integration fit | **Good** — server emits a push event; a parallel path calls a PowerShell script instead of/alongside the web-push route |
| Privacy/security | **Low risk** — toast content should be redacted (same rules as push: only title + short body, no raw args); PowerShell child process under existing shell gating |
| Licensing | **None** (using Windows WinRT built-ins); BurntToast is MIT if used |
| Maintenance | **Low** — Windows WinRT API is stable; BurntToast is actively maintained |
| Platform fit | **Windows-specific** — correct for AVA's single-machine design |
| Cost | **None** — local PowerShell call |
| Reversibility | **Complete** — feature-flag the toast path; existing web-push is unaffected |

---

### Candidate D — PDF/Document Reader Tool (`document_read`)

**What it is:** A new `document_read` tool that accepts a path within the existing filesystem allowlist and returns extracted text for: PDF (via `pdf-parse`, MIT), DOCX (via `mammoth`, MIT), XLSX/CSV (via `xlsx`, Apache-2.0). Reuses the path canonicalization and secret-scrubbing pipeline from `tools/filesystem.ts`.

**Repository evidence:**
- `tools/filesystem-mcp.ts` — `fs_read` only handles UTF-8 text; binary files return an error
- `docs/AVA-CAPABILITIES.md §2` — table shows `fs_read` with "Read a UTF-8 text file"; no document extraction
- `docs/ava-improvement-brainstorm.md §P2-3` — "Deterministic direct integrations ... High ... L-XL" — document reading is a prerequisite for many research workflows
- `tools/shell-tool.ts` — workaround today: run `python -c "import pdfplumber..."` via shell, fragile
- `server/package.json` — no existing document-parsing packages (inferred from tools listing)

**Licensing audit:**
- `pdf-parse` — MIT ✓
- `mammoth` — MIT ✓
- `xlsx` (SheetJS community) — Apache-2.0 ✓ (the paid version is not needed)

**Evaluation:**
| Dimension | Assessment |
|-----------|-----------|
| Delight/usefulness | **High** — "summarize this contract", "what's in this invoice PDF" are common real-world tasks that today require clumsy shell workarounds |
| Overlap | **None** — gap is explicitly documented |
| Integration fit | **Excellent** — follows existing `ToolDef` contract; path allowlist + secret scrubbing already handle the security layer |
| Privacy/security | **Acceptable** — same allowlist as `fs_read`; document text is scrubbed before LLM injection; no network calls |
| Licensing | **Clean** — MIT/Apache-2.0 only |
| Maintenance | **Medium** — PDF parsing can be fragile for complex layouts; `pdf-parse` is widely used but unmaintained upstream; `pdfjs-dist` is the better long-term alternative |
| Platform fit | **Cross-platform** (pure Node) |
| Cost | **None** — local CPU only |
| Reversibility | **Complete** — remove tool registration and package |

---

### Candidate E — Global Hotkey Launcher

**What it is:** A persistent PowerShell background script (or Windows startup task) that registers a global hotkey (e.g., `Win+Shift+Space`). When pressed: if text is selected anywhere on screen, it injects it as the initial text for a new AVA chat. If nothing is selected, it brings the AVA browser window to the foreground.

**Repository evidence:**
- `scripts/start-ava-browser.cmd` — startup scripts already exist in `scripts/`
- `tools/control-app-mcp.ts` — sends keystrokes and foregrounds windows via PowerShell
- `docs/ARCHITECTURE.md §9` — chat view accepts `{ name: "chat"; initialText?: string }` — there's an injection point
- `docs/2026-07-03-ava-roadmap-brainstorm.md §Tier 1` — "reachability" identified as #1 leverage point; hotkey is the desktop equivalent

**Implementation sketch:** `scripts/ava-hotkey.ps1` using `RegisterHotKey` via P/Invoke (no third-party module). Runs as a background job from the systray script. Sends HTTP to `POST /api/chat` with `{ text: clipboardOrSelection }`.

**Evaluation:**
| Dimension | Assessment |
|-----------|-----------|
| Delight/usefulness | **Very high** — the single highest-friction moment in AVA's UX today is switching to the browser to ask something; a hotkey eliminates it |
| Overlap | **None** — no existing hotkey registration |
| Integration fit | **Good** — reuses existing chat API; `initialText` already in view state |
| Privacy/security | **Medium risk** — capturing selected text from any window must never log sensitive content; the text should be scrubbed before transmission; hotkey registration requires foreground-app awareness |
| Licensing | **None** — pure PowerShell/Win32 |
| Maintenance | **Medium** — Windows API quirks (UAC elevation, terminal selection); needs fallback to clipboard |
| Platform fit | **Windows-specific** — correct |
| Cost | **None** |
| Reversibility | **Complete** — kill the background script |

---

### Candidate F — Clipboard Read Tool (`clipboard_read`)

**What it is:** A lightweight `clipboard_read` tool that reads the current Windows clipboard text via PowerShell (`Get-Clipboard`), scrubs secrets, and returns the text. Enables the natural workflow: "I just copied a URL/code/text — do something with it" without Niko having to paste it into the chat manually.

**Repository evidence:**
- `tools/shell-tool.ts` — `Get-Clipboard` is already callable via `shell`, but requires an explicit shell command; a first-class tool makes the intent clearer and enforces scrubbing
- `docs/AVA-CAPABILITIES.md §2` — no `clipboard_read` in the catalog
- `tools/ava-mcp.ts` — `ToolDef` contract is minimal; a clipboard tool is ~20 lines
- `policy/classify.ts` — would classify as `read-only` (no write path)

**Evaluation:**
| Dimension | Assessment |
|-----------|-----------|
| Delight/usefulness | **Medium-high** — removes a small but frequent friction point |
| Overlap | **Minimal** — achievable via `shell` today, but a named tool is discoverable and scrubbing is guaranteed |
| Integration fit | **Excellent** — trivial `ToolDef` addition |
| Privacy/security | **Low risk** — read-only; secret scrubbing applied before returning; no persistent store of clipboard content |
| Licensing | **None** |
| Maintenance | **Very low** |
| Platform fit | **Windows-specific** (PowerShell `Get-Clipboard`) |
| Cost | **None** |
| Reversibility | **Complete** |

---

### Candidate G — Persona Behavioral Dimensions

**What it is:** Extend `server/data/memory/personality.md` with 3-5 explicit bounded behavioral dimensions (verbosity, initiative, formality, warmth, humor) that Niko can tune on the Memory screen. Inspired by the persona-framework research in `docs/reviews/2026-08-27-persona-framework-repository-research.md`. No external code borrowed. A companion frozen test suite validates consistency.

**Repository evidence:**
- `docs/reviews/2026-08-27-persona-framework-repository-research.md` — research done; conclusion: "inspiration-only personality layer"; pattern is: stable traits + bounded adaptation + tests
- `server/data/memory/personality.md` — the live persona file; currently prose; dimensions would be typed key-value sections
- `orchestrator/system-prompt.ts` — assembles the system prompt from memory files; personality.md is injected verbatim; adding structured dimensions is additive
- `web/src/` — Memory screen already renders editable memory files; dimension sliders would be a new component

**Evaluation:**
| Dimension | Assessment |
|-----------|-----------|
| Delight/usefulness | **Medium** — subtle; Niko may not notice unless there's a control surface |
| Overlap | **Unclaimed** — persona v2 was committed (`8d5f2ae`) but behavioral dimensions specifically are undocumented |
| Integration fit | **Good** — additive to personality.md and system-prompt assembly |
| Privacy/security | **Minimal risk** — local memory file; no external data |
| Licensing | **None** — clean-room design |
| Maintenance | **Low** — text-file based |
| Platform fit | **Universal** |
| Cost | **None** |
| Reversibility | **Complete** — dimensions default to neutral if removed |

---

### Candidate H — Proactive Watch Suggestion After Temporal Tasks

**What it is:** After a task completes with a verified outcome and the task had a temporal or conditional dimension (e.g., "check if the RTX price dropped", "see if the visa page changed"), AVA proactively suggests creating a watch. The suggestion appears as a chip below the task result. No automatic watch creation — user must click to confirm.

**Repository evidence:**
- `routes/chat.ts` — emits `final` + `receipt` SSE events on task completion
- `tools/watches-mcp.ts` — `watch_create` exists; proactive suggestion would just pre-fill a chat message
- `docs/ARCHITECTURE.md §11` — watches are already the designed solution for persistent monitoring
- `web/src/chat/ChatScreen.tsx` — suggestion chips already exist (`chip_overrides`, `chip_label_cache` in schema); a post-task chip fits naturally

**Evaluation:**
| Dimension | Assessment |
|-----------|-----------|
| Delight/usefulness | **High** — closes the gap between one-shot research and persistent monitoring without Niko having to think about it |
| Overlap | **None** — no current proactive watch suggestion |
| Integration fit | **Good** — attaches to existing receipt/completion SSE events |
| Privacy/security | **Minimal** — suggestion is read-only; no automatic watch creation |
| Licensing | **None** |
| Maintenance | **Low** |
| Platform fit | **Universal** |
| Cost | **None** |
| Reversibility | **Complete** — remove the suggestion chip logic |

---

### Candidate I — Semantic Playbook Recall (Embedding-based)

**What it is:** Augment `playbooks/match.ts` to use the existing OpenAI embedding model (already wired in semantic memory index) for retrieval, falling back to lexical when no embedding key is present. Fixes the documented miss on pure paraphrase inputs.

**Repository evidence:**
- `docs/ARCHITECTURE.md §8` — "Recall is lexical, not an LLM call ... a pure paraphrase with no shared words won't recall"
- `docs/ava-improvement-brainstorm.md §P2-1` — "Hybrid semantic memory and playbook retrieval ... High ... M-L"
- `docs/2026-07-03-ava-roadmap-brainstorm.md` — "the ceiling is embeddings" — explicitly identified
- `server/src/` — embedding infrastructure exists in the semantic memory index (`memory_index_embeddings` table)
- `playbooks/match.ts` — current lexical scorer; separate embedding path would be additive

**Evaluation:**
| Dimension | Assessment |
|-----------|-----------|
| Delight/usefulness | **Medium-high** — playbooks fire more reliably; invisible improvement to the agent loop |
| Overlap | **Unclaimed** — semantic memory index only indexes research/ideas, not playbooks |
| Integration fit | **Good** — reuses existing embedding table and OpenAI embeddings call |
| Privacy/security | **Minimal** — playbook triggers are already stored; no new sensitive data |
| Licensing | **None** |
| Maintenance | **Medium** — embedding drift over provider changes |
| Platform fit | **Universal** (requires OpenAI key, same as semantic index) |
| Cost | **One embedding call per new playbook created; one per lookup if not cached** — tolerable |
| Reversibility | **Complete** — lexical fallback is the current behavior |

---

### Candidate J — Watches API Surface Completion (pause/resume + search)

**What it is:** Minor server-side additions to the watches routes: `PATCH /api/watches/:id` to pause/resume a watch without deleting it, and `GET /api/watches?q=` for text search. These complete the watches API surface needed by a proper UI screen (Candidate A).

**Repository evidence:**
- `routes/watches.ts` — only `GET`, `POST`, `DELETE` exist; no `PATCH` or search
- `state/watches.ts` — SQLite update is one line; `enabled` column already exists for pause state
- `docs/features/watches.md` — "pause/resume" listed in the Memory section description

**This is a prerequisite for Candidate A, not a standalone recommendation.**

---

### Candidate K — Token/Cost Visibility in Chat (per-turn)

**What it is:** After each assistant response, show a collapsed cost badge (e.g., `~$0.004 · 1.2k tok`) derived from the SSE stream's usage events. Expandable to show: input, output, cached tokens, and estimated cost. Reuses the OpenAI Responses API usage data already present in the stream.

**Repository evidence:**
- `orchestrator/agent.ts` — OpenAI Responses API returns usage per response; these are currently not surfaced to the frontend
- `docs/ava-improvement-brainstorm.md §9` — "Establish performance and release budgets ... Start recording ... Input/output/cached tokens ... Estimated cost by lane"
- `web/src/chat/ChatScreen.tsx` — final answer area; a collapsed cost badge fits after the answer

**Evaluation:**
| Dimension | Assessment |
|-----------|-----------|
| Delight/usefulness | **Medium-high** — makes cost tangible; reinforces frugal watch/self-improvement habits |
| Overlap | **None** — no cost visibility exists |
| Integration fit | **Good** — add usage to SSE `final` event payload; render in chat |
| Privacy/security | **None** — cost data is yours |
| Licensing | **None** |
| Maintenance | **Low** |
| Platform fit | **Universal** |
| Cost | **None** |
| Reversibility | **Complete** |

---

## 4. Ranked shortlist

| Rank | Candidate | Score drivers | Key tradeoff |
|------|-----------|--------------|--------------|
| **1** | **A — Watches UI Screen** | Zero new backend; complete API already exists; fills documented gap; mirrors Self screen; very visible | Purely frontend; needs route for pause + search first (Candidate J, trivial) |
| **2** | **B — Daily Brief Watch Template** | Habitual daily touchpoint; makes AVA ambient; reuses all existing infrastructure; no new code paths | One full agent run per morning (real cost); brief quality depends on watch prompt design |
| **3** | **C — Windows Toast Notifications** | System-level presence; approvals visible without browser focus; delightful as a Windows-first app | PowerShell WinRT bridge is slightly fiddly; content must be redacted before toast |
| **4** | **D — PDF/Document Reader** | Removes common friction (contracts, invoices, reports); reuses allowlist + scrubbing | pdf-parse upstream maintenance gap; complex PDFs fail gracefully but imperfectly |
| **5** | **H — Proactive Watch Suggestion** | Closes research-to-monitoring gap without effort from Niko; very low implementation cost | Requires heuristic to detect "temporal/conditional" tasks; false positives would be annoying |
| **6** | **E — Global Hotkey Launcher** | Highest workflow integration; removes the "switch to browser" step | Selected-text capture across applications needs careful scrubbing; UAC complications |
| **7** | **K — Token/Cost Visibility** | Makes spend tangible; encourages good habits; easy to implement | Adds visual noise to chat if not collapsed by default |
| **8** | **F — Clipboard Read Tool** | Low-friction, high-discoverability | Already possible via shell; marginal value over the status quo |
| **9** | **I — Semantic Playbook Recall** | Invisible but real improvement to recall; reuses existing infrastructure | Medium cost; embedding staleness; Codex's semantic memory index is active — check for overlap |
| **10** | **G — Persona Behavioral Dimensions** | Delightful identity expression; clean-room design | Subtle; hard to verify improvement without test suite; medium implementation effort for subtle result |

---

## 5. Integration sketches

### Sketch A — Watches UI Screen

**Files to create:**
- `web/src/watches/WatchesScreen.tsx` — list of watch cards, create form, status badges
- `web/src/watches/useWatches.ts` — `GET /api/watches` polling hook (15s, same pattern as capability-health polling)

**Files to modify:**
- `web/src/App.tsx` — add `{ name: "watches" }` to the `View` union; add nav entry alongside Memory/Self
- `server/src/routes/watches.ts` — add `PATCH /api/watches/:id` for pause/resume (one SQL `UPDATE watches SET enabled=? WHERE id=?`)

**Watch card fields (from `watches` table):**
- Title: first 60 chars of `prompt`
- Status badge: `enabled` (Active/Paused) + `last_status` (OK/Triggered/Unclear/Pending)
- Schedule: "Every X min" derived from `interval_minutes`
- Last run: `last_run_at` relative time
- Last result: `last_result` collapsed (expandable)
- Actions: Pause/Resume toggle, Run Now, Delete

**Nav slot:** Add "Watches" between Memory and Self in the nav tube. Icon: `Clock` from lucide-react (existing icon set). No new dependency.

**Test additions:** `watches/WatchesScreen.smoke.test.tsx` (mirrors `SelfScreen.smoke.test.tsx`); route tests for `PATCH /api/watches/:id`.

**Reversibility:** Remove the view type and nav entry; no schema change required.

---

### Sketch B — Daily Brief Watch Template

**User interaction:**
1. Niko says: "Set up my morning brief at 8 AM"
2. AVA calls `watch_create` with:
   - `prompt`: a curated multi-part check prompt (weather via browser, Mission Control summary via `read_logs`, pending approvals, active self-improvements, Notes pinned items)
   - `interval_minutes`: 1440 (24h)
   - `once`: false
3. A creation wizard variant in the Watches screen (Candidate A) pre-fills this with time picker

**The brief prompt structure:**
```
You are preparing Niko's morning brief. Check each of these in order:
1. Run read_logs to get Mission Control status for the last 24h.
2. List pending approvals from /api/approvals.
3. List active self-improvements from /api/self.
4. List active watches from watch_list.
5. Use chrome_navigate to check today's weather for Tbilisi.
Synthesize into a structured brief: [Readiness] [Yesterday] [Pending] [Watching] [Weather].
End with WATCH: TRIGGERED — Morning brief ready.
```

**Cost estimate:** ~4-6 tool calls × average tool duration + one LLM synthesis call ≈ $0.02-0.05 per morning. Acceptable.

---

### Sketch C — Windows Toast Notifications

**Implementation path (no third-party module):**
```powershell
# server/scripts/send-toast.ps1
param([string]$Title, [string]$Body, [string]$Tag = "ava")
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(
    [Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$template.GetElementsByTagName("text")[0].AppendChild($template.CreateTextNode($Title)) | Out-Null
$template.GetElementsByTagName("text")[1].AppendChild($template.CreateTextNode($Body)) | Out-Null
$toast = [Windows.UI.Notifications.ToastNotification]::new($template)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("AVA").Show($toast)
```

**Server integration:**
- `push/toast.ts` — new module: `sendWindowsToast(title: string, body: string)` spawns `send-toast.ps1` via `child_process.spawn`
- Called from `push/notify.ts` alongside (not replacing) `sendWebPush`
- Body must pass through `security/scrub.ts` before sending
- Feature-flag: `WINDOWS_TOAST=1` env var enables it

**Approval toast actions** (optional, phase 2): Windows toast action buttons (`<action content="Approve" arguments="approve:ID"/>`) would require a named pipe or loopback HTTP listener to receive the button click — out of scope for phase 1.

---

### Sketch D — PDF/Document Reader

**Package additions:**
```json
"pdf-parse": "^1.1.1",
"mammoth": "^1.8.0"
```

**New file:** `server/src/tools/document-mcp.ts`
```ts
// ToolDef: document_read
// inputSchema: { path: string, max_chars?: number (default 8000) }
// Steps:
// 1. Canonicalize path; verify inside fsRoots (reuse filesystem.ts logic)
// 2. Read buffer
// 3. Detect format by extension (.pdf → pdf-parse; .docx → mammoth; .xlsx → xlsx; else error)
// 4. Extract text; truncate to max_chars
// 5. Scrub secrets from text
// 6. Return { text, ok }
```

**Gating:** `read-only` (reads file, no write path). `.env` and secret-file blocks inherited from path canonicalization.

**Registration:** `chat.ts` alongside `fs_read` (action mode only).

---

## 6. Lessons from the repository

The following constraints, drawn from the codebase and BOARD.md history, must be respected by any new capability:

1. **No real Microsoft UFO runtime.** `tools/ufo-experiment-mcp.ts` is a bounded synthetic fixture only (`docs/features/microsoft-ufo-experiment.md`). Do not claim or build a general UFO computer controller.

2. **No parallel control plane.** `docs/ava-improvement-brainstorm.md §"What not to do"` — do not add a generic parallel action UI or a second orchestration path.

3. **Reuse the evidence seams.** New tools must emit through the existing `tool_call`/`tool_result` SSE grammar and record in Mission Control. No silent side channels.

4. **Experiments default-off.** New capabilities gated by env vars or capability-health checks; never active on a fresh checkout without explicit opt-in.

5. **Observe-only first.** `docs/ava-improvement-brainstorm.md §security` — new data-collection (clipboard, toast content) must be observe-only with scrubbing before any persistence or LLM injection.

6. **Approval-bound for consequential actions.** Any new tool that writes external state (e.g., outbound toast with action buttons, clipboard write) goes through the existing `high` risk tier and approval gate.

7. **No host-resource access.** New tools must respect `fsRoots` canonicalization; no registry writes, no new network listeners without existing infrastructure.

---

## 7. Highest-value single recommendation for Codex

> **Candidate A — Watches UI Screen** is the highest-value, most safely bounded implementation target.

**Why it wins:**

- **Zero new backend.** Routes `GET/POST/DELETE /api/watches` exist in `routes/watches.ts`. Only `PATCH` for pause/resume is missing — a single SQL `UPDATE`.
- **Explicit documentation gap.** `docs/features/watches.md` states: *"A JSON API exists for a future screen."* This is an acknowledged debt, not a speculative feature.
- **Visible impact.** Today, Niko's only view of his standing monitors is through chat commands or a small section of the Memory screen. A dedicated screen transforms an invisible background capability into a first-class control surface.
- **BOARD-safe.** No row in `coord/BOARD.md` claims this area. The watches work in the most recent active codex claim (`Watcher-to-Codex task delivery`) is about delivery mechanics, not the UI screen.
- **Implementation is a direct mirror.** `web/src/self/SelfScreen.tsx` is the template — same card-list pattern, same API polling, same action buttons. Codex already knows that file intimately.
- **No new dependency.** No npm package, no external service, no new LLM call.
- **Reversible.** Add one view type to `App.tsx`, one nav entry, one new file. Remove them to revert.

**Recommended implementation scope for Codex:**
1. `PATCH /api/watches/:id` — pause/resume toggle (`server/src/routes/watches.ts`)
2. `web/src/watches/WatchesScreen.tsx` — card list + status badges + create form
3. `web/src/watches/useWatches.ts` — polling hook
4. `App.tsx` — add `{ name: "watches" }` view; nav entry with `Clock` icon
5. Tests: route test for PATCH; smoke test for WatchesScreen

**Boundary:** Chat/voice management of watches is unchanged. The screen is additive. The existing Memory > Standing watches section can remain or be simplified once the screen is live.

---

## 8. What not to recommend (and why)

| Idea | Reason excluded |
|------|----------------|
| Real Microsoft UFO integration | Board policy; existing adapter is a bounded synthetic fixture only |
| Generic parallel task runner UI | Explicitly listed in brainstorm "What not to do yet" |
| Continuous screen/clipboard monitoring | "Observe-only where applicable" constraint; persistent monitoring creates privacy risk and no approval gate |
| Calendar/email direct API | Correct long-term direction (brainstorm §P2-3) but XL effort; pre-requires reliable execution kernel and health infrastructure |
| Voice wake-word detection | Requires persistent mic access; significant privacy/security surface; no existing web audio persistence model |
| External LLM/agent frameworks (Letta, ElizaOS) | Research doc conclusion: "inspiration only"; direct integration would duplicate AVA's architecture |
| Self-improvement of this research itself | Out of scope; this is a research document |

---

*Document produced 2026-08-29 by Claude (code session) as a research artifact. No code was written, no services were called, no packages were installed. All file paths and line references are grounded in files read during this session.*
