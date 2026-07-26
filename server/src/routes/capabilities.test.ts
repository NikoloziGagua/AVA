import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../state/db.js";
import { bootstrapMemoryDir } from "../memory/bootstrap.js";
import { buildCapabilitySnapshot } from "./capabilities.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("buildCapabilitySnapshot", () => {
  it("reports non-secret readiness and gates browser-bound integrations", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ava-capabilities-"));
    dirs.push(dir);
    bootstrapMemoryDir({ dir: join(dir, "memory") });
    const db = openDb(join(dir, "state.db"));
    const snapshot = await buildCapabilitySnapshot({
      db,
      startedAt: 900,
      provider: "openai",
      memoryDir: join(dir, "memory"),
      browserReadiness: async () => ({ ready: false, mode: "offline" }),
      brainModel: "gpt-5.6",
      voiceModel: "gpt-realtime-2.1",
      voiceName: "marin",
      voiceReady: true,
      shopifyReady: false,
      googlePlacesReady: true,
      screenVisionReady: true,
      pushReady: false,
    }, 1_000);

    expect(snapshot.uptimeMs).toBe(100);
    expect(snapshot.core.brain).toMatchObject({ ready: true, model: "gpt-5.6" });
    expect(snapshot.core.voice).toMatchObject({ model: "gpt-realtime-2.1", speaker: "marin" });
    expect(snapshot.core.browser.ready).toBe(false);
    expect(snapshot.integrations.instagram).toBe(false);
    expect(snapshot.integrations.whatsapp).toBe(false);
    expect(snapshot.integrations.googlePlaces).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain("API_KEY");
    db.close();
  });
});
