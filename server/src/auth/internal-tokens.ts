import type { Db } from "../state/db.js";
import { issueToken, revokeTokensByLabel } from "./tokens.js";

export type InternalTokens = {
  voice: string;
  watch: string;
  retiredVoice: number;
  retiredWatch: number;
};

/** Classify an already-authenticated device, never a request's voice/persist
 * flags or message wording. This is attribution, not a replacement auth gate. */
export function sessionActorForDevice(db: Db, deviceId: string): "human" | "automation" | "voice_action" {
  const row = db.prepare("SELECT session_actor FROM device_tokens WHERE id = ? AND revoked_at IS NULL")
    .get(deviceId) as { session_actor: string } | undefined;
  if (row?.session_actor === "automation") return "automation";
  if (row?.session_actor === "voice_action") return "voice_action";
  return "human";
}

/**
 * Rotate AVA's loopback credentials only after the HTTP listener owns its port.
 *
 * A process that loses an EADDRINUSE race must never revoke the healthy
 * process's token. Keeping the rotation behind the successful listen callback
 * closes the repeated watcher POST /api/chat 401 failure.
 */
export function rotateInternalTokens(db: Db): InternalTokens {
  const retiredVoice = revokeTokensByLabel(db, "voice-internal");
  const retiredWatch = revokeTokensByLabel(db, "watch-internal");
  return {
    voice: issueToken(db, { label: "voice-internal", sessionActor: "voice_action" }).secret,
    watch: issueToken(db, { label: "watch-internal", sessionActor: "automation" }).secret,
    retiredVoice,
    retiredWatch,
  };
}
