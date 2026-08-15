-- server/src/state/schema.sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);

-- Sanitized task-result snapshots shown in conversation. Mission Control owns
-- the full event history; this table stores only the bounded receipt JSON so
-- the latest diagnostic card survives a server restart or later reopen.
CREATE TABLE IF NOT EXISTS task_receipts (
  task_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  receipt_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_receipts_session
  ON task_receipts(session_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_receipts_expiry
  ON task_receipts(expires_at);

CREATE TABLE IF NOT EXISTS tool_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  message_id INTEGER REFERENCES messages(id),
  tool TEXT NOT NULL,
  args TEXT NOT NULL,
  result TEXT,
  status TEXT NOT NULL,
  duration_ms INTEGER,
  created_at INTEGER NOT NULL
);

-- Explorer is append-only at the event layer. Task rows are current-state
-- projections; the immutable event rows retain the original execution history.
-- There is intentionally no legacy-session backfill: old conversations do not
-- contain reliable run boundaries or complete tool evidence.
CREATE TABLE IF NOT EXISTS explorer_tasks (
  id TEXT PRIMARY KEY,
  -- Execution history outlives optional chat-history cleanup. The original
  -- session link becomes null instead of silently erasing the trace.
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  original_request TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  outcome TEXT NOT NULL DEFAULT 'running',
  verification_status TEXT NOT NULL DEFAULT 'not_recorded',
  final_response TEXT,
  error_message TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_explorer_tasks_started
  ON explorer_tasks(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_explorer_tasks_status
  ON explorer_tasks(status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_explorer_tasks_session
  ON explorer_tasks(session_id, started_at DESC);

CREATE TABLE IF NOT EXISTS explorer_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES explorer_tasks(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  tool_name TEXT,
  capability_ids TEXT NOT NULL DEFAULT '[]',
  sanitised_input TEXT,
  sanitised_output TEXT,
  error_message TEXT,
  duration_ms INTEGER,
  occurred_at INTEGER NOT NULL,
  privacy_level TEXT NOT NULL DEFAULT 'personal',
  data_source TEXT NOT NULL DEFAULT 'instrumented_runtime',
  UNIQUE(task_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_explorer_events_task
  ON explorer_events(task_id, sequence);

-- Mission Control's shared observability model. Runs are mutable projections;
-- events are the append-only source of truth. This is deliberately separate
-- from the first Explorer tables: Explorer's v1 rows model chat-agent evidence,
-- while this contract must also represent voice sessions/turns, Forge
-- environments, nested Codex/Claude agents, watches and future adapters without
-- manufacturing those concepts inside a chat task.
CREATE TABLE IF NOT EXISTS observability_runs (
  id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL,
  parent_run_id TEXT REFERENCES observability_runs(id) ON DELETE SET NULL,
  root_task_id TEXT,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  run_kind TEXT NOT NULL,
  runtime_id TEXT NOT NULL,
  runtime_type TEXT NOT NULL,
  host_runtime_id TEXT,
  owner_type TEXT NOT NULL,
  owner_id TEXT,
  owner_role TEXT,
  title TEXT NOT NULL,
  objective TEXT,
  status TEXT NOT NULL,
  outcome TEXT,
  verification_status TEXT NOT NULL DEFAULT 'not_recorded',
  privacy_level TEXT NOT NULL DEFAULT 'personal',
  retention_class TEXT NOT NULL DEFAULT 'detail_30d',
  compact_summary TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_event_at INTEGER NOT NULL,
  completed_at INTEGER,
  stale_after_ms INTEGER NOT NULL DEFAULT 60000,
  detailed_expires_at INTEGER NOT NULL,
  compact_expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_observability_runs_started
  ON observability_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_observability_runs_status
  ON observability_runs(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_observability_runs_trace
  ON observability_runs(trace_id, started_at);
CREATE INDEX IF NOT EXISTS idx_observability_runs_parent
  ON observability_runs(parent_run_id, started_at);
CREATE INDEX IF NOT EXISTS idx_observability_runs_session
  ON observability_runs(session_id, started_at DESC);

CREATE TABLE IF NOT EXISTS observability_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  run_id TEXT NOT NULL REFERENCES observability_runs(id) ON DELETE CASCADE,
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  parent_span_id TEXT,
  causation_event_id TEXT,
  producer_id TEXT NOT NULL,
  producer_event_id TEXT,
  producer_sequence INTEGER,
  runtime_id TEXT NOT NULL,
  runtime_type TEXT NOT NULL,
  host_runtime_id TEXT,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  actor_role TEXT,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  visibility TEXT NOT NULL DEFAULT 'summary',
  privacy_level TEXT NOT NULL DEFAULT 'personal',
  sanitised_payload TEXT,
  error_message TEXT,
  action_id TEXT,
  action_owner TEXT,
  action_counted INTEGER NOT NULL DEFAULT 0,
  provider_request_id TEXT,
  cost_kind TEXT,
  cost_microusd INTEGER,
  accounting_applied INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cached_tokens INTEGER,
  duration_ms INTEGER,
  occurred_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  is_terminal INTEGER NOT NULL DEFAULT 0,
  is_late INTEGER NOT NULL DEFAULT 0,
  projection_applied INTEGER NOT NULL DEFAULT 1,
  dedup_key TEXT NOT NULL UNIQUE,
  UNIQUE(producer_id, producer_event_id)
);

CREATE INDEX IF NOT EXISTS idx_observability_events_run
  ON observability_events(run_id, seq);
CREATE INDEX IF NOT EXISTS idx_observability_events_trace
  ON observability_events(trace_id, seq);
CREATE INDEX IF NOT EXISTS idx_observability_events_type
  ON observability_events(type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_observability_events_action
  ON observability_events(action_id)
  WHERE action_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_observability_events_provider
  ON observability_events(provider_request_id)
  WHERE provider_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_observability_actual_provider_cost
  ON observability_events(provider_request_id)
  WHERE provider_request_id IS NOT NULL
    AND cost_kind = 'actual_provider'
    AND accounting_applied = 1;

CREATE TABLE IF NOT EXISTS device_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER
);

CREATE TABLE IF NOT EXISTS pairing_codes (
  code TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_token_id TEXT REFERENCES device_tokens(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  device_label TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  parsed TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  tool TEXT NOT NULL,
  args TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  decided_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_approvals_session_status ON approvals(session_id, status);

CREATE TABLE IF NOT EXISTS device_state (
  device_id TEXT PRIMARY KEY REFERENCES device_tokens(id) ON DELETE CASCADE,
  last_greeting_date TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chip_overrides (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES device_tokens(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  prompt TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chip_overrides_device ON chip_overrides(device_id, position);

CREATE TABLE IF NOT EXISTS reasoning_pref (
  scope_id   TEXT PRIMARY KEY,
  level      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS voice_engine_pref (
  scope_id   TEXT PRIMARY KEY,
  engine     TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chip_label_cache (
  device_id    TEXT NOT NULL,
  prompt_hash  TEXT NOT NULL,
  label        TEXT NOT NULL,
  expires_at   INTEGER NOT NULL,
  PRIMARY KEY (device_id, prompt_hash)
);

CREATE TABLE IF NOT EXISTS self_improvements (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  trigger TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  branch TEXT,
  commit_sha TEXT,
  last_known_good TEXT,
  diff_summary TEXT,
  verify_log TEXT,
  outcome TEXT,
  error TEXT,
  worker_provider TEXT NOT NULL DEFAULT 'claude',
  worker_selection_version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS self_worker_settings (
  scope_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS discussions (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  topic TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',   -- running | done | failed
  result TEXT,
  error TEXT,
  session_id TEXT
);

-- Strategy Room: a persistent, attributed discussion shared by Niko, AVA and
-- real external agent sessions. Approval records a decision only; it never
-- executes development work.
CREATE TABLE IF NOT EXISTS strategy_rooms (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  topic TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'discussing',
  phase TEXT NOT NULL DEFAULT 'framing',
  active_actor TEXT,
  round INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  living_brief TEXT,
  conclusion TEXT,
  codex_thread_id TEXT,
  error TEXT,
  source_session_id TEXT,
  source_through_message_id INTEGER,
  returned_message_id INTEGER,
  returned_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  approved_at INTEGER,
  stopped_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_strategy_rooms_updated
  ON strategy_rooms(updated_at DESC);

CREATE TABLE IF NOT EXISTS strategy_messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES strategy_rooms(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  author TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(room_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_strategy_messages_room
  ON strategy_messages(room_id, sequence);

-- Append-only transport journal. SQLite is authoritative; the in-process
-- subscriber only removes latency, and clients can replay from `seq`.
CREATE TABLE IF NOT EXISTS strategy_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  room_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_strategy_events_room
  ON strategy_events(room_id, seq);

-- Structured Notes is Sir's intentional knowledge workspace. Project spaces
-- are first-class so an empty project still exists and can expose the standard
-- capture / priorities / decisions / documentation template.
CREATE TABLE IF NOT EXISTS note_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Notes are user-facing, editable and organised into kinds, projects, template
-- sections and Kanban stages. JSON fields contain bounded safe links and a
-- concise immutable change history. `version` guards against one browser or
-- agent silently overwriting another's newer edit.
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'ideas',
  collection TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  pinned INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual',
  source_session_id TEXT,
  project_id TEXT,
  section TEXT NOT NULL DEFAULT 'capture',
  links TEXT NOT NULL DEFAULT '[]',
  change_log TEXT NOT NULL DEFAULT '[]',
  promoted_type TEXT,
  promoted_id TEXT,
  promoted_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_updated
  ON notes(pinned DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_notes_kind_status
  ON notes(kind, status, updated_at DESC);

-- Legacy visual explanations remain readable for migration. New revisions use
-- the renderer-neutral visual_message_revisions table below; rendered HTML,
-- SVG, and PNG remain disposable browser artifacts and are never persisted.
CREATE TABLE IF NOT EXISTS visual_explanations (
  id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  mermaid TEXT NOT NULL,
  storyboard TEXT NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  source_session_id TEXT,
  source_run_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_visual_explanations_updated
  ON visual_explanations(updated_at DESC, id);

-- Renderer-neutral visual messages are immutable by (id, revision). Mermaid is
-- one validated renderer payload derived from the semantic model, never the
-- canonical source. Message metadata stores only exact id/revision references.
CREATE TABLE IF NOT EXISTS visual_message_revisions (
  visual_message_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  schema_version TEXT NOT NULL,
  diagram_kind TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  semantic_model TEXT NOT NULL,
  storyboard TEXT NOT NULL,
  renderer TEXT NOT NULL,
  accessible_fallback TEXT NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  source_session_id TEXT,
  source_run_id TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (visual_message_id, revision)
);

CREATE INDEX IF NOT EXISTS idx_visual_message_revisions_latest
  ON visual_message_revisions(visual_message_id, revision DESC);

CREATE INDEX IF NOT EXISTS idx_visual_message_revisions_created
  ON visual_message_revisions(created_at DESC, visual_message_id);

CREATE TABLE IF NOT EXISTS watches (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,               -- what to check + what counts as triggered
  interval_minutes INTEGER NOT NULL,
  once INTEGER NOT NULL DEFAULT 1,    -- 1 = disable after first trigger
  enabled INTEGER NOT NULL DEFAULT 1,
  session_id TEXT,                    -- chat session holding every check run (visibility)
  created_at INTEGER NOT NULL,
  last_run_at INTEGER,
  last_status TEXT,                   -- check/reminder outcomes or targeted-delivery lifecycle state
  last_result TEXT,                   -- one-line latest status/reason
  run_at INTEGER,                     -- one-shot: fire once at/after this epoch-ms
  daily_at TEXT,                      -- recurring: fire once per day at HH:MM local
  kind TEXT NOT NULL DEFAULT 'check', -- check = agent run | reminder = direct push | codex = pinned Codex task
  target_thread_id TEXT,
  target_session_file TEXT,
  target_cwd TEXT,
  continue_cycle INTEGER NOT NULL DEFAULT 0,
  parent_watch_id TEXT,
  delivery_marker TEXT,
  dispatch_offset INTEGER,
  dispatch_turn_id TEXT,
  dispatch_pid INTEGER,
  delivered_at INTEGER,
  completed_at INTEGER
);
