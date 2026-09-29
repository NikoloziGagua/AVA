-- server/src/state/schema.sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  origin TEXT NOT NULL DEFAULT 'unknown' CHECK (origin IN ('human', 'automation', 'unknown', 'assistant')),
  last_human_activity_at INTEGER
);

-- Retain accepted new-conversation identity after deletion and retention purge.
-- No cascading session foreign key: retries must fail closed, not create anew.
CREATE TABLE IF NOT EXISTS session_binding_requests (
  device_id TEXT NOT NULL,
  binding_request_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('human', 'automation')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, binding_request_id)
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

-- Initiative publication points at ordinary conversation data, never a second
-- transcript. Keep the occurrence/budget receipt when a conversation is purged.
CREATE TABLE IF NOT EXISTS initiatives (
  id TEXT PRIMARY KEY CHECK (id GLOB 'ini_*'),
  occurrence_key TEXT NOT NULL UNIQUE,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('general', 'project')),
  scope_folder_id TEXT,
  sources TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(sources) AND json_type(sources) = 'array' AND json_array_length(sources) <= 8),
  reason_now TEXT NOT NULL DEFAULT '' CHECK (length(reason_now) <= 300),
  title TEXT NOT NULL DEFAULT '' CHECK (length(title) <= 80),
  state TEXT NOT NULL CHECK (state IN ('claimed', 'generating', 'generated', 'publishing', 'published', 'suppressed', 'failed')),
  suppression_reason TEXT CHECK (suppression_reason IN ('disabled', 'quiet_hours', 'budget', 'no_grounded_idea', 'stale_source', 'duplicate', 'out_of_window', 'no_eligible_scope')),
  failure_reason TEXT CHECK (failure_reason IN ('generation_failed', 'publication_failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 2),
  attempt_token TEXT,
  lease_until INTEGER,
  created_at INTEGER NOT NULL,
  published_at INTEGER,
  expires_at INTEGER,
  session_id TEXT UNIQUE REFERENCES sessions(id) ON DELETE SET NULL,
  message_id INTEGER UNIQUE REFERENCES messages(id) ON DELETE SET NULL,
  notification_state TEXT NOT NULL DEFAULT 'none'
    CHECK (notification_state IN ('none', 'sending', 'accepted', 'rejected', 'unknown', 'no_subscription')),
  notification_send_token TEXT,
  notification_attempted_at INTEGER,
  notification_reason_code TEXT,
  opened_at INTEGER,
  disposition_state TEXT NOT NULL DEFAULT 'open' CHECK (disposition_state IN ('open', 'later', 'not_useful', 'engaged')),
  disposition_version INTEGER NOT NULL DEFAULT 1 CHECK (disposition_version >= 1),
  disposition_updated_at INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  CHECK ((scope_kind = 'general' AND scope_folder_id IS NULL)
    OR (scope_kind = 'project' AND scope_folder_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_initiatives_inbox ON initiatives(state, disposition_state, published_at DESC, session_id);

CREATE TABLE IF NOT EXISTS initiative_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  delivery_local_time TEXT NOT NULL,
  quiet_start TEXT NOT NULL,
  quiet_end TEXT NOT NULL,
  active_project_folder_ids TEXT NOT NULL CHECK (json_valid(active_project_folder_ids)),
  version INTEGER NOT NULL CHECK (version >= 1)
);

-- Semantic memory is a compact discovery index, not a transcript duplicate.
-- Entries contain only bounded sanitized summaries; sources retain exact
-- conversation-range references and a content fingerprint so retrieval can be
-- verified against the authoritative message rows before AVA trusts it.
CREATE TABLE IF NOT EXISTS memory_index_entries (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  conclusions TEXT NOT NULL DEFAULT '[]',
  open_questions TEXT NOT NULL DEFAULT '[]',
  next_steps TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  project TEXT,
  project_key TEXT,
  privacy_level TEXT NOT NULL DEFAULT 'personal',
  capture_mode TEXT NOT NULL DEFAULT 'explicit',
  capture_reason TEXT,
  thread_id TEXT,
  parent_entry_id TEXT REFERENCES memory_index_entries(id) ON DELETE SET NULL,
  checkpoint_sequence INTEGER NOT NULL DEFAULT 1,
  checkpoint_kind TEXT NOT NULL DEFAULT 'initial',
  checkpoint_reason TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  embedding_status TEXT NOT NULL DEFAULT 'pending',
  source_fingerprint TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  forgotten_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_memory_index_scope
  ON memory_index_entries(status, privacy_level, project_key, updated_at DESC);

CREATE TABLE IF NOT EXISTS memory_index_sources (
  entry_id TEXT PRIMARY KEY REFERENCES memory_index_entries(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL DEFAULT 'conversation_range',
  source_ref TEXT,
  source_label TEXT NOT NULL,
  from_message_id INTEGER NOT NULL,
  through_message_id INTEGER NOT NULL,
  message_count INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  availability TEXT NOT NULL DEFAULT 'verified',
  last_verified_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_memory_index_source_session
  ON memory_index_sources(session_id, from_message_id, through_message_id);

-- Immutable, sanitized product-change evidence. The memory index points here
-- for committed AVA improvements instead of manufacturing a conversation.
-- A record is usable only while its exact commit remains reachable from the
-- current AVA branch and the stored record fingerprint still matches.
CREATE TABLE IF NOT EXISTS improvement_records (
  id TEXT PRIMARY KEY,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL UNIQUE,
  commit_sha TEXT NOT NULL UNIQUE,
  actor TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  capabilities TEXT NOT NULL DEFAULT '[]',
  changed_files TEXT NOT NULL DEFAULT '[]',
  verification TEXT NOT NULL DEFAULT '[]',
  record_fingerprint TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  indexed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_improvement_records_created
  ON improvement_records(created_at DESC, id);

-- Vectors are replaceable discovery data. Their provider/model/dimensions and
-- exact sanitized-input hash travel with them so incompatible vector spaces
-- are never compared. Forgetting an entry deletes this row immediately.
CREATE TABLE IF NOT EXISTS memory_index_embeddings (
  entry_id TEXT PRIMARY KEY REFERENCES memory_index_entries(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  input_hash TEXT NOT NULL,
  vector BLOB NOT NULL,
  created_at INTEGER NOT NULL
);

-- One content-free decision record per assistant turn considered for automatic
-- durable memory. It makes provider retries/replayed terminal events idempotent
-- without copying prompts, transcripts, or generated summaries into a queue.
CREATE TABLE IF NOT EXISTS memory_index_auto_events (
  assistant_message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  candidate_kind TEXT,
  reason TEXT NOT NULL,
  entry_id TEXT REFERENCES memory_index_entries(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_index_auto_session
  ON memory_index_auto_events(session_id, updated_at DESC);

-- Experimental Microsoft UFO boundary. This stores only the deterministic,
-- host-isolated fixture projection and bounded sanitized request evidence. It
-- is not a UFO installation, provider payload store, or generic control plane.
CREATE TABLE IF NOT EXISTS ufo_fixture_state (
  fixture_id TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ufo_experiment_requests (
  id TEXT PRIMARY KEY,
  request_key TEXT NOT NULL UNIQUE,
  observability_run_id TEXT NOT NULL UNIQUE,
  input_fingerprint TEXT NOT NULL,
  fixture_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  steps INTEGER NOT NULL DEFAULT 0,
  max_steps INTEGER NOT NULL,
  input_summary TEXT NOT NULL,
  output_summary TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_ufo_experiment_status
  ON ufo_experiment_requests(status, updated_at DESC);

-- Phase 5 governance is append-only. The projection below is only the current
-- fast lookup state; every user/AVA decision is retained in the immutable event
-- table with actor, reason, target and resulting version. Memory entry content
-- and source fingerprints are never rewritten by governance actions.
CREATE TABLE IF NOT EXISTS memory_index_thread_state (
  thread_id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1,
  pinned INTEGER NOT NULL DEFAULT 0,
  current_entry_id TEXT REFERENCES memory_index_entries(id) ON DELETE SET NULL,
  superseded_by_thread_id TEXT,
  conflict_status TEXT NOT NULL DEFAULT 'none',
  conflict_with TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_index_thread_governance
  ON memory_index_thread_state(pinned DESC, conflict_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS memory_index_governance_events (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  entry_id TEXT REFERENCES memory_index_entries(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  target_thread_id TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  request_key TEXT NOT NULL UNIQUE,
  resulting_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_index_governance_thread
  ON memory_index_governance_events(thread_id, created_at DESC, id DESC);

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
  -- SHA-256 of the secret for O(1) validation; NULL until a legacy token is next used.
  token_lookup TEXT,
  label TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER,
  session_actor TEXT NOT NULL DEFAULT 'human' CHECK (session_actor IN ('human', 'automation', 'voice_action'))
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

-- AVA's discussion-only agentroom membership is a user-governed global
-- capability. Credentials remain in the environment; SQLite stores only the
-- off/on preference and its optimistic-concurrency version.
CREATE TABLE IF NOT EXISTS agentroom_pref (
  scope_id   TEXT PRIMARY KEY,
  enabled    INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  version    INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

-- One authenticated, durable appearance preference shared by AVA's clients.
-- Browser storage is only a first-paint/offline mirror; this row is authority.
CREATE TABLE IF NOT EXISTS ui_preferences (
  scope_id    TEXT PRIMARY KEY,
  look        TEXT NOT NULL DEFAULT 'ink' CHECK (look IN ('ink', 'paper', 'system')),
  motion      TEXT NOT NULL DEFAULT 'full' CHECK (motion IN ('full', 'reduced', 'system')),
  face_enabled INTEGER NOT NULL DEFAULT 1 CHECK (face_enabled IN (0, 1)),
  version     INTEGER NOT NULL DEFAULT 1,
  updated_at  INTEGER NOT NULL
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
  worker_selection_version INTEGER NOT NULL DEFAULT 1,
  cancellation_source TEXT
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

-- Structured Notes is Sir's intentional knowledge workspace. Folders are the
-- canonical hierarchy; the older project-space table remains as a v1
-- compatibility projection for the optional Board and existing clients.
CREATE TABLE IF NOT EXISTS note_folders (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES note_folders(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  built_in INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_note_folders_root_name
  ON note_folders(name COLLATE NOCASE) WHERE parent_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_note_folders_child_name
  ON note_folders(parent_id, name COLLATE NOCASE) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_note_folders_parent_order
  ON note_folders(parent_id, position, name COLLATE NOCASE);

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
  folder_id TEXT REFERENCES note_folders(id) ON DELETE RESTRICT,
  document_type TEXT NOT NULL DEFAULT 'general',
  document_position INTEGER NOT NULL DEFAULT 0,
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

-- AVA-owned deterministic automations. The external workflow engine is an
-- executor, never the authority: AVA owns request identity, lifecycle,
-- verification and the compact evidence record. Raw workflow payloads and
-- credentials are deliberately absent.
CREATE TABLE IF NOT EXISTS automation_runs (
  id TEXT PRIMARY KEY,
  request_key TEXT NOT NULL UNIQUE,
  input_fingerprint TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  workflow_version INTEGER NOT NULL,
  executor TEXT NOT NULL,
  external_run_id TEXT,
  observability_run_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  step_count INTEGER NOT NULL DEFAULT 0,
  input_summary TEXT NOT NULL,
  output_summary TEXT,
  artifact_path TEXT,
  artifact_hash TEXT,
  memory_entry_id TEXT,
  verification_state TEXT NOT NULL DEFAULT 'unverified',
  verification_method TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_updated
  ON automation_runs(updated_at DESC, id);

-- Immutable source record used by the semantic index after an automation
-- artifact has independently passed AVA's verifier. The referenced file stays
-- authoritative; this row and the compact memory entry are discovery data.
CREATE TABLE IF NOT EXISTS automation_artifact_records (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE REFERENCES automation_runs(id) ON DELETE RESTRICT,
  workflow_id TEXT NOT NULL,
  workflow_version INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  artifact_path TEXT NOT NULL,
  artifact_hash TEXT NOT NULL,
  verification_method TEXT NOT NULL,
  record_fingerprint TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_automation_artifacts_created
  ON automation_artifact_records(created_at DESC, id);

-- Automatically discovered Activepieces playbook candidates. A candidate is
-- append-evidenced and cannot run until an explicit approval drives it through
-- Activepieces plan validation into `active`. Definitions are bounded JSON;
-- raw prompts, provider payloads and tool output are deliberately absent.
CREATE TABLE IF NOT EXISTS automation_playbook_candidates (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  playbook_id TEXT NOT NULL UNIQUE,
  revision INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'observing',
  version INTEGER NOT NULL DEFAULT 1,
  display_name TEXT NOT NULL,
  trigger_phrases TEXT NOT NULL,
  definition TEXT NOT NULL,
  evidence_task_ids TEXT NOT NULL DEFAULT '[]',
  evidence_count INTEGER NOT NULL DEFAULT 0,
  validation_run_id TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  approved_at INTEGER,
  activated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_automation_candidates_status
  ON automation_playbook_candidates(status, updated_at DESC, id);

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
  time_zone TEXT,                     -- named zone recorded at one-off intake; legacy unknown
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
  completed_at INTEGER,
  successor_status TEXT,
  successor_result TEXT,
  successor_attempted_at INTEGER,
  successor_session_id TEXT
);

-- One authoritative receipt per direct reminder occurrence. No push payload,
-- subscription credentials or duplicated prompt is stored here.
CREATE TABLE IF NOT EXISTS reminder_occurrences (
  id TEXT PRIMARY KEY,
  watch_id TEXT NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
  due_at INTEGER NOT NULL,
  time_zone TEXT,
  expires_at INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  phase TEXT NOT NULL CHECK (phase IN ('scheduled','claimed','sending','retry_scheduled','accepted','failed','expired','acceptance_unknown','cancelled')),
  lease_token TEXT,
  lease_until INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at INTEGER,
  next_attempt_at INTEGER,
  accepted_at INTEGER,
  total INTEGER NOT NULL DEFAULT 0,
  accepted INTEGER NOT NULL DEFAULT 0,
  rejected_transient INTEGER NOT NULL DEFAULT 0,
  rejected_permanent INTEGER NOT NULL DEFAULT 0,
  unknown INTEGER NOT NULL DEFAULT 0,
  reason_code TEXT,
  UNIQUE(watch_id, due_at)
);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminder_occurrences(phase, next_attempt_at);

-- Calendar v1 is the authoritative schedule definition. Reminder delivery is
-- deliberately not duplicated here: C3 projects event-owned offsets into the
-- existing watches/reminder_occurrences transport with stable links.
CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('lecture','event','block')),
  time_zone TEXT NOT NULL DEFAULT 'Europe/Dublin',
  anchor_local_date TEXT NOT NULL,
  start_local_time TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 1 AND 10080),
  recurrence_kind TEXT NOT NULL CHECK (recurrence_kind IN ('none','weekly')),
  recurrence_until_date TEXT,
  dst_policy TEXT NOT NULL DEFAULT 'reject' CHECK (dst_policy IN ('reject','earlier','later')),
  attendance_intent TEXT NOT NULL DEFAULT 'undecided' CHECK (attendance_intent IN ('undecided','attend','skip')),
  notes_folder_id TEXT REFERENCES note_folders(id) ON DELETE SET NULL,
  reminder_minutes_before INTEGER CHECK (reminder_minutes_before IS NULL OR reminder_minutes_before BETWEEN 0 AND 10080),
  split_from_event_id TEXT REFERENCES calendar_events(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  source_session_id TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_anchor
  ON calendar_events(anchor_local_date, recurrence_until_date, archived_at);
CREATE INDEX IF NOT EXISTS idx_calendar_events_notes_folder
  ON calendar_events(notes_folder_id) WHERE notes_folder_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS calendar_event_exceptions (
  event_id TEXT NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  occurrence_local_date TEXT NOT NULL,
  moved_local_date TEXT,
  moved_local_time TEXT,
  moved_duration_minutes INTEGER CHECK (moved_duration_minutes IS NULL OR moved_duration_minutes BETWEEN 1 AND 10080),
  cancelled INTEGER NOT NULL DEFAULT 0 CHECK (cancelled IN (0,1)),
  attendance_intent_override TEXT CHECK (attendance_intent_override IS NULL OR attendance_intent_override IN ('undecided','attend','skip')),
  attendance_outcome TEXT NOT NULL DEFAULT 'unknown' CHECK (attendance_outcome IN ('unknown','attended','skipped','missed')),
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, occurrence_local_date)
);

CREATE INDEX IF NOT EXISTS idx_calendar_exceptions_event
  ON calendar_event_exceptions(event_id, occurrence_local_date);

-- Memory archive (memory v2): typed, dated records of what Niko has told AVA.
-- A change never overwrites: the old record becomes history with valid_to and
-- superseded_by_id set. Only "forget" deletes, and it leaves a tombstone so
-- extraction and backfill can never recreate the fact. seq is the stable
-- rowid the full-text index follows (a TEXT primary key's rowid can change
-- on VACUUM).
CREATE TABLE IF NOT EXISTS memory_records (
  seq INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('fact','person','project','decision','commitment','preference','event')),
  topic TEXT NOT NULL,
  text TEXT NOT NULL,
  speech_act TEXT NOT NULL CHECK (speech_act IN ('stated','decided','requested','discussed','inferred')),
  status TEXT NOT NULL CHECK (status IN ('active','history','unconfirmed')),
  carry INTEGER NOT NULL DEFAULT 1 CHECK (carry IN (0,1)),
  sensitive INTEGER NOT NULL DEFAULT 0 CHECK (sensitive IN (0,1)),
  confidence TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
  origin TEXT NOT NULL CHECK (origin IN ('explicit','conversation','backfill','migration')),
  source_session_id TEXT,
  source_message_ids TEXT NOT NULL DEFAULT '[]',
  said_at INTEGER NOT NULL,
  valid_from INTEGER NOT NULL,
  valid_to INTEGER,
  due_at INTEGER,
  supersedes_id TEXT,
  superseded_by_id TEXT,
  text_fingerprint TEXT NOT NULL,
  topic_fingerprint TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_records_current
  ON memory_records(status, kind, said_at);
CREATE INDEX IF NOT EXISTS idx_memory_records_topic
  ON memory_records(topic_fingerprint, kind, status);
CREATE INDEX IF NOT EXISTS idx_memory_records_text
  ON memory_records(text_fingerprint);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_records_fts USING fts5(
  topic, text, content='memory_records', content_rowid='seq',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS memory_records_fts_insert AFTER INSERT ON memory_records BEGIN
  INSERT INTO memory_records_fts(rowid, topic, text) VALUES (new.seq, new.topic, new.text);
END;
CREATE TRIGGER IF NOT EXISTS memory_records_fts_delete AFTER DELETE ON memory_records BEGIN
  INSERT INTO memory_records_fts(memory_records_fts, rowid, topic, text) VALUES ('delete', old.seq, old.topic, old.text);
END;
CREATE TRIGGER IF NOT EXISTS memory_records_fts_update AFTER UPDATE OF topic, text ON memory_records BEGIN
  INSERT INTO memory_records_fts(memory_records_fts, rowid, topic, text) VALUES ('delete', old.seq, old.topic, old.text);
  INSERT INTO memory_records_fts(rowid, topic, text) VALUES (new.seq, new.topic, new.text);
END;

-- What "forget" leaves behind: fingerprints and message ids, never the text.
-- A candidate matching any of them is refused, and recall skips the messages.
CREATE TABLE IF NOT EXISTS memory_tombstones (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  text_fingerprint TEXT NOT NULL,
  topic_fingerprint TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('forgotten','rejected','forgotten_index_entry')),
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_tombstones_text ON memory_tombstones(text_fingerprint);
CREATE INDEX IF NOT EXISTS idx_memory_tombstones_topic ON memory_tombstones(topic_fingerprint, kind);

CREATE TABLE IF NOT EXISTS memory_tombstone_messages (
  message_id INTEGER NOT NULL,
  tombstone_id TEXT NOT NULL REFERENCES memory_tombstones(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, tombstone_id)
);

-- Append-only log of every memory change: the "just learned" feed and the
-- audit trail. A forgotten record's events keep no summary.
CREATE TABLE IF NOT EXISTS memory_record_events (
  seq INTEGER PRIMARY KEY,
  record_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('added','updated','ended','stopped_carrying','carried','confirmed','forgotten')),
  actor TEXT NOT NULL CHECK (actor IN ('niko','ava','extractor','backfill','migration')),
  summary TEXT,
  session_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_record_events_created
  ON memory_record_events(created_at DESC, seq DESC);

-- How far the background extractor has read each conversation.
CREATE TABLE IF NOT EXISTS memory_extraction_state (
  session_id TEXT PRIMARY KEY,
  through_message_id INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_extraction_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  from_message_id INTEGER NOT NULL,
  through_message_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
  model TEXT,
  proposed INTEGER NOT NULL DEFAULT 0,
  applied INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);
