import type { Db } from "../state/db.js";
import { issueToken, revokeTokensByLabel } from "./tokens.js";

export type InternalTokens = {
  voice: string;
  watch: string;
  retiredVoice: number;
  retiredWatch: number;
};

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
    voice: issueToken(db, { label: "voice-internal" }).secret,
    watch: issueToken(db, { label: "watch-internal" }).secret,
    retiredVoice,
    retiredWatch,
  };
}
