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
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);

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
  error TEXT
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


CREATE TABLE IF NOT EXISTS watches (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,               -- what to check + what counts as triggered
  interval_minutes INTEGER NOT NULL,
  once INTEGER NOT NULL DEFAULT 1,    -- 1 = disable after first trigger
  enabled INTEGER NOT NULL DEFAULT 1,
  session_id TEXT,                    -- chat session holding every check run (visibility)
  created_at INTEGER NOT NULL,
  last_run_at INTEGER,
  last_status TEXT,                   -- ok | triggered | unclear | error
  last_result TEXT                    -- one-line latest status/reason
);
