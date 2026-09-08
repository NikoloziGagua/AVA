import { describe, expect, it } from "vitest";
import { openInMemoryDb } from "../state/db.js";
import { rotateInternalTokens } from "./internal-tokens.js";
import { issueToken, validateToken } from "./tokens.js";

describe("internal token rotation", () => {
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
    expect(validateToken(db, device)).not.toBeNull();
  });
});
