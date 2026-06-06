import type { Db } from "./db.js";

// How Ava's voice is PRODUCED — a single global preference, mirroring
// reasoning-pref.ts:
//
//   "openai"     (default) — the realtime model speaks (OpenAI voice) AND
//                            /api/speak uses OpenAI gpt-4o-mini-tts. The current,
//                            unchanged behaviour.
//   "chatterbox"           — the realtime model does NOT speak (transcribe-only)
//                            AND /api/speak uses the LOCAL Chatterbox TTS server,
//                            so ALL of Ava's voice is the local cloned voice.
//   "hybrid"               — the realtime model speaks chitchat (OpenAI voice)
//                            AND /api/speak uses Chatterbox, so task narration /
//                            results come back in the cloned voice.
export type VoiceEngine = "openai" | "chatterbox" | "hybrid";

const SCOPE = "global";

function isVoiceEngine(v: unknown): v is VoiceEngine {
  return v === "openai" || v === "chatterbox" || v === "hybrid";
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
