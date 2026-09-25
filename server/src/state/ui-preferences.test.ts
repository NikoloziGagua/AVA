import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "./db.js";
import { getUiPreferences, updateUiPreferences } from "./ui-preferences.js";

const cleanup: string[] = [];
afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("UI preferences", () => {
  it("defaults to Ink, full motion and the face enabled", () => {
    const db = openDb(":memory:");
    expect(getUiPreferences(db)).toMatchObject({
      look: "ink", motion: "full", faceEnabled: true, version: 1,
    });
    db.close();
  });

  it("updates atomically and rejects a stale writer without losing the current row", () => {
    const db = openDb(":memory:");
    expect(updateUiPreferences(db, 1, { look: "paper", faceEnabled: false }, 100)).toEqual({
      ok: true,
      preferences: { look: "paper", motion: "full", faceEnabled: false, version: 2, updatedAt: 100 },
    });
    expect(updateUiPreferences(db, 1, { motion: "reduced" }, 200)).toEqual({
      ok: false,
      reason: "stale_version",
      preferences: { look: "paper", motion: "full", faceEnabled: false, version: 2, updatedAt: 100 },
    });
    db.close();
  });

  it("survives a database restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "ava-ui-pref-"));
    cleanup.push(dir);
    const path = join(dir, "ava.db");
    const first = openDb(path);
    expect(updateUiPreferences(first, 1, { motion: "system" }, 300).ok).toBe(true);
    first.close();
    const reopened = openDb(path);
    expect(getUiPreferences(reopened)).toEqual({
      look: "ink", motion: "system", faceEnabled: true, version: 2, updatedAt: 300,
    });
    reopened.close();
  });
});
