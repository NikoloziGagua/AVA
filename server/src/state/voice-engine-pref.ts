import type { Db } from "./db.js";

// Which voice PROVIDER speaks for Ava — a single global preference, mirroring
// reasoning-pref.ts. This is the dashboard's voice toggle:
//
//   "openai" (default) — the OpenAI GA realtime model speaks; /api/speak uses
//                        OpenAI gpt-4o-mini-tts.
//   "hume"             — Hume EVI speaks (the "Alice Bennett" voice); requires
//                        HUME_API_KEY in env, else the proxy falls back to OpenAI.
//
// (The older "chatterbox"/"hybrid" local-clone options were retired from the UI;
// a stale row with either value falls back to "openai".)
export type VoiceEngine = "openai" | "hume";

const SCOPE = "global";

function isVoiceEngine(v: unknown): v is VoiceEngine {
  return v === "openai" || v === "hume";
}

export function getVoiceEngine(db: Db): VoiceEngine {
  const row = db
    .prepare("SELECT engine FROM voice_engine_pref WHERE scope_id = ?")
    .get(SCOPE) as { engine: string } | undefined;
  if (row && isVoiceEngine(row.engine)) return row.engine;
  return "openai";
}

export function setVoiceEngine(db: Db, engine: VoiceEngine): void {
  db.prepare(
    `INSERT INTO voice_engine_pref (scope_id, engine, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(scope_id) DO UPDATE SET engine = excluded.engine, updated_at = excluded.updated_at`,
  ).run(SCOPE, engine, Date.now());
}
