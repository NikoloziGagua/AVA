import { describe, expect, it } from "vitest";
import { openInMemoryDb } from "../state/db.js";
import { rotateInternalTokens, sessionActorForDevice } from "./internal-tokens.js";
import { issueToken, validateToken } from "./tokens.js";

describe("internal token rotation", () => {
  it("attributes only dedicated authenticated internal credentials, not client voice flags or titles", () => {
    const db = openInMemoryDb();
    const human = issueToken(db, { label: "Niko's phone" });
    const voice = issueToken(db, { label: "voice-internal", sessionActor: "voice_action" });
    const watch = issueToken(db, { label: "watch-internal", sessionActor: "automation" });
    expect(sessionActorForDevice(db, human.id)).toBe("human");
    expect(sessionActorForDevice(db, voice.id)).toBe("voice_action");
    expect(sessionActorForDevice(db, watch.id)).toBe("automation");
    for (const label of ["voice-internal", "watch-internal"]) {
      expect(sessionActorForDevice(db, issueToken(db, { label }).id)).toBe("human");
    }
    db.close();
  });
  it("retires only the prior internal credentials and leaves device tokens valid", () => {
    const db = openInMemoryDb();
    const device = issueToken(db, { label: "Niko's phone" }).secret;
    const oldVoice = issueToken(db, { label: "voice-internal" }).secret;
    const oldWatch = issueToken(db, { label: "watch-internal" }).secret;

    const next = rotateInternalTokens(db);

    expect(next.retiredVoice).toBe(1);
    expect(next.retiredWatch).toBe(1);
    expect(validateToken(db, oldVoice)).toBeNull();
    expect(validateToken(db, oldWatch)).toBeNull();
    expect(validateToken(db, next.voice)).not.toBeNull();
    expect(validateToken(db, next.watch)).not.toBeNull();
    expect(sessionActorForDevice(db, validateToken(db, next.watch)!)).toBe("automation");
    expect(sessionActorForDevice(db, validateToken(db, next.voice)!)).toBe("voice_action");
    expect(validateToken(db, device)).not.toBeNull();
  });
});
